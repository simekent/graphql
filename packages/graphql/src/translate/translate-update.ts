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

import type { Node, Relationship } from "../classes";
import type { CypherFieldReferenceMap, GraphQLWhereArg, RelationField } from "../types";
import createProjectionAndParams from "./create-projection-and-params";
import createCreateAndParams from "./create-create-and-params";
import createUpdateAndParams from "./create-update-and-params";
import createConnectAndParams from "./create-connect-and-params";
import createDisconnectAndParams from "./create-disconnect-and-params";
import { META_CYPHER_VARIABLE } from "../constants";
import createDeleteAndParams from "./create-delete-and-params";
import createSetRelationshipPropertiesAndParams from "./create-set-relationship-properties-and-params";
import { translateTopLevelMatch } from "./translate-top-level-match";
import { createConnectOrCreateAndParams } from "./create-connect-or-create-and-params";
import createRelationshipValidationStr from "./create-relationship-validation-string";
import { CallbackBucket } from "../classes/CallbackBucket";
import Cypher from "@neo4j/cypher-builder";
import { createConnectionEventMeta } from "../translate/subscriptions/create-connection-event-meta";
import { filterMetaVariable } from "../translate/subscriptions/filter-meta-variable";
import { compileCypher } from "../utils/compile-cypher";
import type { Neo4jGraphQLTranslationContext } from "../types/neo4j-graphql-translation-context";
import { getAuthorizationStatements } from "./utils/get-authorization-statements";

export default async function translateUpdate({
    node,
    context,
}: {
    node: Node;
    context: Neo4jGraphQLTranslationContext;
}): Promise<[string, any]> {
    const { resolveTree } = context;
    const updateInput = resolveTree.args.update;
    const connectInput = resolveTree.args.connect;
    const disconnectInput = resolveTree.args.disconnect;
    const createInput = resolveTree.args.create;
    const deleteInput = resolveTree.args.delete;
    const connectOrCreateInput = resolveTree.args.connectOrCreate;
    const varName = "this";
    const callbackBucket: CallbackBucket = new CallbackBucket(context);
    const cypherFieldAliasMap: CypherFieldReferenceMap = {};
    const withVars = [varName];

    if (context.subscriptionsEnabled) {
        withVars.push(META_CYPHER_VARIABLE);
    }

    let matchAndWhereStr = "";
    let updateStr = "";
    const connectStrs: string[] = [];
    const disconnectStrs: string[] = [];
    const createStrs: string[] = [];
    let deleteStr = "";
    let projAuth: Cypher.Clause | undefined = undefined;
    const assumeReconnecting = Boolean(connectInput) && Boolean(disconnectInput);
    const matchNode = new Cypher.NamedNode(varName, { labels: node.getLabels(context) });
    const where = resolveTree.args.where as GraphQLWhereArg | undefined;
    const topLevelMatch = translateTopLevelMatch({ matchNode, node, context, operation: "UPDATE", where });
    matchAndWhereStr = topLevelMatch.cypher;
    let cypherParams = topLevelMatch.params;

    const connectionStrs: string[] = [];
    const interfaceStrs: string[] = [];
    let updateArgs = {};

    const mutationResponse = resolveTree.fieldsByTypeName[node.mutationResponseTypeNames.update] || {};

    const nodeProjection = Object.values(mutationResponse).find((field) => field.name === node.plural);

    if (deleteInput) {
        const deleteAndParams = createDeleteAndParams({
            context,
            node,
            deleteInput,
            varName: `${varName}_delete`,
            parentVar: varName,
            withVars,
            parameterPrefix: `${resolveTree.name}.args.delete`,
        });
        [deleteStr] = deleteAndParams;
        cypherParams = {
            ...cypherParams,
            ...deleteAndParams[1],
        };
        updateArgs = {
            ...updateArgs,
            ...(deleteStr.includes(resolveTree.name) ? { delete: deleteInput } : {}),
        };
    }

    if (disconnectInput) {
        Object.entries(disconnectInput).forEach((entry) => {
            const relationField = node.relationFields.find((x) => x.fieldName === entry[0]) as RelationField;
            const refNodes: Node[] = [];

            if (relationField.union) {
                Object.keys(entry[1]).forEach((unionTypeName) => {
                    refNodes.push(context.nodes.find((x) => x.name === unionTypeName) as Node);
                });
            } else if (relationField.interface) {
                relationField.interface?.implementations?.forEach((implementationName) => {
                    refNodes.push(context.nodes.find((x) => x.name === implementationName) as Node);
                });
            } else {
                refNodes.push(context.nodes.find((x) => x.name === relationField.typeMeta.name) as Node);
            }

            if (relationField.interface) {
                const disconnectAndParams = createDisconnectAndParams({
                    context,
                    parentVar: varName,
                    refNodes,
                    relationField,
                    value: entry[1],
                    varName: `${varName}_disconnect_${entry[0]}`,
                    withVars,
                    parentNode: node,
                    parameterPrefix: `${resolveTree.name}.args.disconnect.${entry[0]}`,
                    labelOverride: "",
                });
                disconnectStrs.push(disconnectAndParams[0]);
                cypherParams = { ...cypherParams, ...disconnectAndParams[1] };
            } else {
                refNodes.forEach((refNode) => {
                    const disconnectAndParams = createDisconnectAndParams({
                        context,
                        parentVar: varName,
                        refNodes: [refNode],
                        relationField,
                        value: relationField.union ? entry[1][refNode.name] : entry[1],
                        varName: `${varName}_disconnect_${entry[0]}${relationField.union ? `_${refNode.name}` : ""}`,
                        withVars,
                        parentNode: node,
                        parameterPrefix: `${resolveTree.name}.args.disconnect.${entry[0]}${
                            relationField.union ? `.${refNode.name}` : ""
                        }`,
                        labelOverride: relationField.union ? refNode.name : "",
                    });
                    disconnectStrs.push(disconnectAndParams[0]);
                    cypherParams = { ...cypherParams, ...disconnectAndParams[1] };
                });
            }
        });

        updateArgs = {
            ...updateArgs,
            disconnect: disconnectInput,
        };
    }

    if (updateInput) {
        const updateAndParams = createUpdateAndParams({
            context,
            callbackBucket,
            node,
            updateInput,
            varName,
            parentVar: varName,
            withVars,
            parameterPrefix: `${resolveTree.name}.args.update`,
            includeRelationshipValidation: false,
        });
        [updateStr] = updateAndParams;
        cypherParams = {
            ...cypherParams,
            ...updateAndParams[1],
        };
        updateArgs = {
            ...updateArgs,
            ...(updateStr.includes(resolveTree.name) ? { update: updateInput } : {}),
        };
    }

    if (connectInput) {
        Object.entries(connectInput).forEach((entry) => {
            const relationField = node.relationFields.find((x) => entry[0] === x.fieldName) as RelationField;

            const refNodes: Node[] = [];

            if (relationField.union) {
                Object.keys(entry[1]).forEach((unionTypeName) => {
                    refNodes.push(context.nodes.find((x) => x.name === unionTypeName) as Node);
                });
            } else if (relationField.interface) {
                relationField.interface?.implementations?.forEach((implementationName) => {
                    refNodes.push(context.nodes.find((x) => x.name === implementationName) as Node);
                });
            } else {
                refNodes.push(context.nodes.find((x) => x.name === relationField.typeMeta.name) as Node);
            }

            if (relationField.interface) {
                if (!relationField.typeMeta.array) {
                    const inStr = relationField.direction === "IN" ? "<-" : "-";
                    const outStr = relationField.direction === "OUT" ? "->" : "-";

                    const validatePredicates: string[] = [];
                    refNodes.forEach((refNode) => {
                        const validateRelationshipExistence = `EXISTS((${varName})${inStr}[:${relationField.type}]${outStr}(:${refNode.name}))`;
                        validatePredicates.push(validateRelationshipExistence);
                    });

                    if (validatePredicates.length) {
                        connectStrs.push("WITH *");
                        connectStrs.push(
                            `WHERE apoc.util.validatePredicate(${validatePredicates.join(
                                " OR "
                            )},'Relationship field "%s.%s" cannot have more than one node linked',["${
                                relationField.connectionPrefix
                            }","${relationField.fieldName}"])`
                        );
                    }
                }

                const connectAndParams = createConnectAndParams({
                    context,
                    callbackBucket,
                    parentVar: varName,
                    refNodes,
                    relationField,
                    value: entry[1],
                    varName: `${varName}_connect_${entry[0]}`,
                    withVars,
                    parentNode: node,
                    labelOverride: "",
                    includeRelationshipValidation: !!assumeReconnecting,
                    source: "UPDATE",
                });
                connectStrs.push(connectAndParams[0]);
                cypherParams = { ...cypherParams, ...connectAndParams[1] };
            } else {
                refNodes.forEach((refNode) => {
                    const connectAndParams = createConnectAndParams({
                        context,
                        callbackBucket,
                        parentVar: varName,
                        refNodes: [refNode],
                        relationField,
                        value: relationField.union ? entry[1][refNode.name] : entry[1],
                        varName: `${varName}_connect_${entry[0]}${relationField.union ? `_${refNode.name}` : ""}`,
                        withVars,
                        parentNode: node,
                        labelOverride: relationField.union ? refNode.name : "",
                        source: "UPDATE",
                    });
                    connectStrs.push(connectAndParams[0]);
                    cypherParams = { ...cypherParams, ...connectAndParams[1] };
                });
            }
        });
    }

    if (connectOrCreateInput) {
        Object.entries(connectOrCreateInput).forEach(([key, input]) => {
            const relationField = node.relationFields.find((x) => key === x.fieldName) as RelationField;

            const refNodes: Node[] = [];

            if (relationField.union) {
                Object.keys(input).forEach((unionTypeName) => {
                    refNodes.push(context.nodes.find((x) => x.name === unionTypeName) as Node);
                });
            } else if (relationField.interface) {
                relationField.interface?.implementations?.forEach((implementationName) => {
                    refNodes.push(context.nodes.find((x) => x.name === implementationName) as Node);
                });
            } else {
                refNodes.push(context.nodes.find((x) => x.name === relationField.typeMeta.name) as Node);
            }

            refNodes.forEach((refNode) => {
                const { cypher, params } = createConnectOrCreateAndParams({
                    input: input[refNode.name] || input, // Deals with different input from update -> connectOrCreate
                    varName: `${varName}_connectOrCreate_${key}${relationField.union ? `_${refNode.name}` : ""}`,
                    parentVar: varName,
                    relationField,
                    refNode,
                    node,
                    context,
                    withVars,
                    callbackBucket,
                });
                connectStrs.push(cypher);
                cypherParams = { ...cypherParams, ...params };
            });
        });
    }

    if (createInput) {
        Object.entries(createInput).forEach((entry) => {
            const relationField = node.relationFields.find((x) => entry[0] === x.fieldName) as RelationField;

            const refNodes: Node[] = [];

            if (relationField.union) {
                Object.keys(entry[1]).forEach((unionTypeName) => {
                    refNodes.push(context.nodes.find((x) => x.name === unionTypeName) as Node);
                });
            } else if (relationField.interface) {
                relationField.interface?.implementations?.forEach((implementationName) => {
                    refNodes.push(context.nodes.find((x) => x.name === implementationName) as Node);
                });
            } else {
                refNodes.push(context.nodes.find((x) => x.name === relationField.typeMeta.name) as Node);
            }

            const inStr = relationField.direction === "IN" ? "<-" : "-";
            const outStr = relationField.direction === "OUT" ? "->" : "-";

            refNodes.forEach((refNode) => {
                let v = relationField.union ? entry[1][refNode.name] : entry[1];

                if (relationField.interface) {
                    if (relationField.typeMeta.array) {
                        v = entry[1]
                            .filter((c) => Object.keys(c.node).includes(refNode.name))
                            .map((c) => ({ edge: c.edge, node: c.node[refNode.name] }));

                        if (!v.length) {
                            return;
                        }
                    } else {
                        if (!entry[1].node[refNode.name]) {
                            return;
                        }
                        v = { edge: entry[1].edge, node: entry[1].node[refNode.name] };
                    }
                }

                const creates = relationField.typeMeta.array ? v : [v];
                creates.forEach((create, index) => {
                    const baseName = `${varName}_create_${entry[0]}${
                        relationField.union || relationField.interface ? `_${refNode.name}` : ""
                    }${index}`;
                    const nodeName = `${baseName}_node${relationField.interface ? `_${refNode.name}` : ""}`;
                    const propertiesName = `${baseName}_relationship`;
                    const relationVarName =
                        relationField.properties || context.subscriptionsEnabled ? propertiesName : "";
                    const relTypeStr = `[${relationVarName}:${relationField.type}]`;

                    if (!relationField.typeMeta.array) {
                        createStrs.push("WITH *");

                        const validatePredicateTemplate = (condition: string) =>
                            `WHERE apoc.util.validatePredicate(${condition},'Relationship field "%s.%s" cannot have more than one node linked',["${relationField.connectionPrefix}","${relationField.fieldName}"])`;

                        const singleCardinalityValidationTemplate = (nodeName) =>
                            `EXISTS((${varName})${inStr}[:${relationField.type}]${outStr}(:${nodeName}))`;

                        if (relationField.union && relationField.union.nodes) {
                            const validateRelationshipExistence = relationField.union.nodes.map(
                                singleCardinalityValidationTemplate
                            );
                            createStrs.push(validatePredicateTemplate(validateRelationshipExistence.join(" OR ")));
                        } else if (relationField.interface && relationField.interface.implementations) {
                            const validateRelationshipExistence = relationField.interface.implementations.map(
                                singleCardinalityValidationTemplate
                            );
                            createStrs.push(validatePredicateTemplate(validateRelationshipExistence.join(" OR ")));
                        } else {
                            const validateRelationshipExistence = singleCardinalityValidationTemplate(refNode.name);
                            createStrs.push(validatePredicateTemplate(validateRelationshipExistence));
                        }
                    }

                    const {
                        create: nestedCreate,
                        params,
                        authorizationPredicates,
                        authorizationSubqueries,
                    } = createCreateAndParams({
                        context,
                        callbackBucket,
                        node: refNode,
                        input: create.node,
                        varName: nodeName,
                        withVars: [...withVars, nodeName],
                        includeRelationshipValidation: false,
                    });
                    createStrs.push(nestedCreate);
                    cypherParams = { ...cypherParams, ...params };
                    createStrs.push(`MERGE (${varName})${inStr}${relTypeStr}${outStr}(${nodeName})`);

                    if (relationField.properties) {
                        const relationship = context.relationships.find(
                            (x) => x.properties === relationField.properties
                        ) as unknown as Relationship;

                        const setA = createSetRelationshipPropertiesAndParams({
                            properties: create.edge ?? {},
                            varName: propertiesName,
                            relationship,
                            operation: "CREATE",
                            callbackBucket,
                        });
                        createStrs.push(setA[0]);
                        cypherParams = { ...cypherParams, ...setA[1] };
                    }

                    creates.push(...getAuthorizationStatements(authorizationPredicates, authorizationSubqueries));

                    if (context.subscriptionsEnabled) {
                        const [fromVariable, toVariable] =
                            relationField.direction === "IN" ? [nodeName, varName] : [varName, nodeName];
                        const [fromTypename, toTypename] =
                            relationField.direction === "IN" ? [refNode.name, node.name] : [node.name, refNode.name];
                        const eventWithMetaStr = createConnectionEventMeta({
                            event: "create_relationship",
                            relVariable: propertiesName,
                            fromVariable,
                            toVariable,
                            typename: relationField.typeUnescaped,
                            fromTypename,
                            toTypename,
                        });
                        createStrs.push(
                            `WITH ${eventWithMetaStr}, ${filterMetaVariable([...withVars, nodeName]).join(", ")}`
                        );
                    }
                });
            });
        });
    }

    let projectionSubquery: Cypher.Clause | undefined;
    let projStr: Cypher.Expr | undefined;
    if (nodeProjection?.fieldsByTypeName) {
        const projection = createProjectionAndParams({
            node,
            context,
            resolveTree: nodeProjection,
            varName: new Cypher.NamedNode(varName),
            cypherFieldAliasMap,
        });
        projectionSubquery = Cypher.concat(...projection.subqueriesBeforeSort, ...projection.subqueries);
        projStr = projection.projection;
        cypherParams = { ...cypherParams, ...projection.params };
        const predicates: Cypher.Predicate[] = [];

        predicates.push(...projection.predicates);

        if (predicates.length) {
            projAuth = new Cypher.With("*").where(Cypher.and(...predicates));
        }
    }

    const returnStatement = generateUpdateReturnStatement(varName, projStr, context.subscriptionsEnabled);

    const relationshipValidationStr = createRelationshipValidationStr({ node, context, varName });

    const updateQuery = new Cypher.Raw((env: Cypher.Environment) => {
        const projectionSubqueryStr = projectionSubquery ? compileCypher(projectionSubquery, env) : "";

        const cypher = [
            ...(context.subscriptionsEnabled ? [`WITH [] AS ${META_CYPHER_VARIABLE}`] : []),
            matchAndWhereStr,
            deleteStr,
            disconnectStrs.join("\n"),
            updateStr,
            connectStrs.join("\n"),
            createStrs.join("\n"),
            ...(deleteStr.length ||
            connectStrs.length ||
            disconnectStrs.length ||
            createStrs.length ||
            projectionSubqueryStr
                ? [`WITH *`]
                : []), // When FOREACH is the last line of update 'Neo4jError: WITH is required between FOREACH and CALL'

            projectionSubqueryStr,
            ...(connectionStrs.length ? [`WITH *`] : []), // When FOREACH is the last line of update 'Neo4jError: WITH is required between FOREACH and CALL'
            ...(projAuth ? [compileCypher(projAuth, env)] : []),
            ...(relationshipValidationStr ? [`WITH *`, relationshipValidationStr] : []),
            ...connectionStrs,
            ...interfaceStrs,
            ...(context.subscriptionsEnabled
                ? [
                      `WITH *`,
                      `UNWIND (CASE ${META_CYPHER_VARIABLE} WHEN [] then [null] else ${META_CYPHER_VARIABLE} end) AS m`,
                  ]
                : []),
            compileCypher(returnStatement, env),
        ]
            .filter(Boolean)
            .join("\n");

        return [
            cypher,
            {
                ...cypherParams,
                ...(Object.keys(updateArgs).length ? { [resolveTree.name]: { args: updateArgs } } : {}),
            },
        ];
    });

    const cypherResult = updateQuery.build("update_");
    const { cypher, params: resolvedCallbacks } = await callbackBucket.resolveCallbacksAndFilterCypher({
        cypher: cypherResult.cypher,
    });
    const result: [string, Record<string, any>] = [cypher, { ...cypherResult.params, resolvedCallbacks }];
    return result;
}

function generateUpdateReturnStatement(
    varName: string | undefined,
    projStr: Cypher.Expr | undefined,
    subscriptionsEnabled: boolean
): Cypher.Clause {
    let statements;
    if (varName && projStr) {
        statements = new Cypher.Raw((env) => `collect(DISTINCT ${varName} ${compileCypher(projStr, env)}) AS data`);
    }

    if (subscriptionsEnabled) {
        statements = Cypher.concat(
            statements,
            new Cypher.Raw(statements ? ", " : ""),
            new Cypher.Raw(`collect(DISTINCT m) as ${META_CYPHER_VARIABLE}`)
        );
    }

    if (!statements) {
        statements = new Cypher.Raw("'Query cannot conclude with CALL'");
    }

    return new Cypher.Return(statements);
}
