/*
 * Copyright (c) "Neo4j"
 * Neo4j Sweden AB [http://neo4j.com]
 *
 * This file is part of Neo4j.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { Node } from "../classes";
import type { GraphQLWhereArg } from "../types";
import { META_CYPHER_VARIABLE } from "../constants";
import createDeleteAndParams from "./create-delete-and-params";
import { translateTopLevelMatch } from "./translate-top-level-match";
import { createEventMeta } from "./subscriptions/create-event-meta";
import Cypher from "@neo4j/cypher-builder";
import { createConnectionEventMetaObject } from "./subscriptions/create-connection-event-meta";
import { checkAuthentication } from "./authorization/check-authentication";
import type { Neo4jGraphQLTranslationContext } from "../types/neo4j-graphql-translation-context";

export function translateDelete({
    context,
    node,
}: {
    context: Neo4jGraphQLTranslationContext;
    node: Node;
}): Cypher.CypherResult {
    const { resolveTree } = context;
    const deleteInput = resolveTree.args.delete;
    const varName = "this";
    let matchAndWhereStr = "";
    let deleteStr = "";
    let cypherParams: Record<string, any> = {};

    const withVars = [varName];

    if (context.subscriptionsEnabled) {
        withVars.push(META_CYPHER_VARIABLE);
    }

    const where = resolveTree.args.where as GraphQLWhereArg | undefined;

    const matchNode = new Cypher.NamedNode(varName, { labels: node.getLabels(context) });
    const topLevelMatch = translateTopLevelMatch({ matchNode, node, context, operation: "DELETE", where });
    matchAndWhereStr = topLevelMatch.cypher;
    cypherParams = { ...cypherParams, ...topLevelMatch.params };

    if (deleteInput) {
        const deleteAndParams = createDeleteAndParams({
            context,
            node,
            deleteInput,
            varName,
            parentVar: varName,
            withVars,
            parameterPrefix: `${varName}_${resolveTree.name}.args.delete`,
        });
        [deleteStr] = deleteAndParams;
        cypherParams = {
            ...cypherParams,
            ...(deleteStr.includes(resolveTree.name)
                ? { [`${varName}_${resolveTree.name}`]: { args: { delete: deleteInput } } }
                : {}),
            ...deleteAndParams[1],
        };
    } else {
        checkAuthentication({ context, node, targetOperations: ["DELETE"] });
    }

    if (context.subscriptionsEnabled && !deleteInput) {
        deleteStr = findConnectedNodesCypherQuery(varName);
    }

    const deleteQuery = new Cypher.Raw(() => {
        const eventMeta = createEventMeta({ event: "delete", nodeVariable: varName, typename: node.name });
        const cypher = [
            ...(context.subscriptionsEnabled ? [`WITH [] AS ${META_CYPHER_VARIABLE}`] : []),
            matchAndWhereStr,
            ...(context.subscriptionsEnabled ? [`WITH ${varName}, ${eventMeta}`] : []),
            deleteStr,
            `DETACH DELETE ${varName}`,
            ...getDeleteReturn(context),
        ];

        return [cypher.filter(Boolean).join("\n"), cypherParams];
    });

    const result = deleteQuery.build(varName);
    return result;
}

function getDeleteReturn(context: Neo4jGraphQLTranslationContext): Array<string> {
    return context.subscriptionsEnabled
        ? [
              `WITH collect(${META_CYPHER_VARIABLE}) AS ${META_CYPHER_VARIABLE}`,
              `WITH REDUCE(m=[], n IN ${META_CYPHER_VARIABLE} | m + n) AS ${META_CYPHER_VARIABLE}`,
              `RETURN ${META_CYPHER_VARIABLE}`,
          ]
        : [];
}

function findConnectedNodesCypherQuery(varName: string): string {
    return [
        `CALL {`,
        `\tWITH ${varName}`,
        `\tOPTIONAL MATCH (${varName})-[r]-()`,
        `\tWITH ${varName}, collect(DISTINCT r) AS relationships_to_delete`,
        `\tUNWIND relationships_to_delete AS x`,
        `\tWITH CASE`,
        `\t\tWHEN id(${varName})=id(startNode(x)) THEN ${createDisconnectEventMetaForDeletedNode({
            relVariable: "x",
            fromVariable: varName,
            toVariable: "endNode(x)",
        })}`,
        `\t\tWHEN id(${varName})=id(endNode(x)) THEN ${createDisconnectEventMetaForDeletedNode({
            relVariable: "x",
            fromVariable: "startNode(x)",
            toVariable: varName,
        })}`,
        `\tEND AS meta`,
        `\tRETURN collect(DISTINCT meta) AS relationship_meta`,
        `}`,
        `WITH REDUCE(m=meta, r IN relationship_meta | m + r) AS meta, ${varName}`,
    ].join("\n");
}

function createDisconnectEventMetaForDeletedNode({ relVariable, fromVariable, toVariable }) {
    return createConnectionEventMetaObject({
        event: "delete_relationship",
        relVariable,
        fromVariable,
        toVariable,
        typename: `type(${relVariable})`,
        fromLabels: `labels(${fromVariable})`,
        toLabels: `labels(${toVariable})`,
        toProperties: `properties(${toVariable})`,
        fromProperties: `properties(${fromVariable})`,
    });
}
