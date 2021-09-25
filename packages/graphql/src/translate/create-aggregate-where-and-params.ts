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

import { Node, Relationship } from "../classes";
import { RelationField, Context, BaseField } from "../types";

const fieldOperators = ["EQUAL", "GT", "GTE", "LT", "LTE"];

type Operator = "=" | "<" | "<=" | ">" | ">=";

function createOperator(input): Operator {
    let operator: Operator = "=";

    switch (input) {
        case "LT":
            operator = "<";
            break;
        case "LTE":
            operator = "<=";
            break;
        case "GT":
            operator = ">";
            break;
        case "GTE":
            operator = ">=";
            break;
        default:
            operator = "=";
            break;
    }

    return operator;
}

function idkWhatToCallThisYet({
    inputValue,
    nodeOrRelationship,
    chainStr,
    variable,
}: {
    inputValue: any;
    nodeOrRelationship: Node | Relationship;
    chainStr: string;
    variable: string;
}): [string, any] {
    const cyphers: string[] = [];
    let params = {};

    Object.entries(inputValue).forEach((e) => {
        const f = [...nodeOrRelationship.primitiveFields, ...nodeOrRelationship.temporalFields].find((field) =>
            fieldOperators.some((op) => e[0].split(`_${op}`)[0] === field.fieldName)
        ) as BaseField;

        if (!f) {
            return;
        }

        const [, operatorString] = e[0].split(`${f.fieldName}_`);
        const operator = createOperator(operatorString);

        const paramName = `${chainStr}_${e[0]}`;
        params[paramName] = e[1];

        if (f.typeMeta.name === "String") {
            if (operator !== "=") {
                cyphers.push(`size(${variable}.${f.fieldName}) ${operator} $${paramName}`);

                return;
            }
        }

        // Default
        cyphers.push(`${variable}.${f.fieldName} ${operator} $${paramName}`);
    });

    return [cyphers.join(" AND "), params];
}

function createPredicate({
    node,
    aggregation,
    context,
    chainStr,
    field,
    varName,
    nodeVariable,
    edgeVariable,
    relationship,
}: {
    aggregation: any;
    node: Node;
    context: Context;
    chainStr: string;
    field: RelationField;
    varName: string;
    nodeVariable: string;
    edgeVariable: string;
    relationship: Relationship;
}): [string, any] {
    const cyphers: string[] = [];
    let params = {};

    Object.entries(aggregation).forEach((entry) => {
        if (["AND", "OR"].includes(entry[0])) {
            const innerClauses: string[] = [];

            ((entry[1] as unknown) as any[]).forEach((v: any, i) => {
                const recurse = createPredicate({
                    node,
                    chainStr: `${chainStr}_${entry[0]}_${i}`,
                    context,
                    field,
                    varName,
                    aggregation: v,
                    nodeVariable,
                    edgeVariable,
                    relationship,
                });
                if (recurse[0]) {
                    innerClauses.push(recurse[0]);
                    params = { ...params, ...recurse[1] };
                }
            });

            if (innerClauses.length) {
                cyphers.push(`(${innerClauses.join(` ${entry[0]} `)})`);
            }

            return;
        }

        ["count", "count_LT", "count_LTE", "count_GT", "count_GTE"].forEach((countType) => {
            if (entry[0] === countType) {
                const paramName = `${chainStr}_${entry[0]}`;
                params[paramName] = entry[1];

                const operator = createOperator(countType.split("_")[1]);

                cyphers.push(`count(${nodeVariable}) ${operator} $${paramName}`);
            }
        });

        if (entry[0] === "node") {
            const nodeValue = entry[1] as any;

            const nodeThingy = idkWhatToCallThisYet({
                chainStr: `${chainStr}_${entry[0]}`,
                inputValue: nodeValue,
                nodeOrRelationship: node,
                variable: nodeVariable,
            });

            if (nodeThingy[0]) {
                cyphers.push(nodeThingy[0]);
                params = { ...params, ...nodeThingy[1] };
            }
        }

        if (entry[0] === "edge") {
            const edgeValue = entry[1] as any;

            const edgeThingy = idkWhatToCallThisYet({
                chainStr: `${chainStr}_${entry[0]}`,
                inputValue: edgeValue,
                nodeOrRelationship: relationship,
                variable: edgeVariable,
            });

            if (edgeThingy[0]) {
                cyphers.push(edgeThingy[0]);
                params = { ...params, ...edgeThingy[1] };
            }
        }
    });

    return [cyphers.join(" AND "), params];
}

function createAggregateWhereAndParams({
    node,
    field,
    varName,
    chainStr,
    context,
    aggregation,
    relationship,
}: {
    node: Node;
    field: RelationField;
    varName: string;
    chainStr: string;
    context: Context;
    aggregation: any;
    relationship: Relationship;
}): [string, any] {
    const cyphers: string[] = [];
    let params = {};

    const inStr = field.direction === "IN" ? "<-" : "-";
    const outStr = field.direction === "OUT" ? "->" : "-";
    const nodeVariable = `${chainStr}_node`;
    const edgeVariable = `${chainStr}_edge`;
    const relTypeStr = `[${edgeVariable}:${field.type}]`;

    const matchStr = `MATCH (${varName})${inStr}${relTypeStr}${outStr}(${nodeVariable}:${field.typeMeta.name})`;
    cyphers.push(`apoc.cypher.runFirstColumn(\" ${matchStr}`);

    const predicate = createPredicate({
        aggregation,
        chainStr,
        context,
        field,
        node,
        nodeVariable,
        edgeVariable,
        varName,
        relationship,
    });
    if (predicate[0]) {
        params = { ...params, ...predicate[1] };
        cyphers.push(`RETURN ${predicate[0]}`);
    }

    const apocParams = Object.keys(params).length
        ? `, ${Object.keys(params)
              .map((x) => `${x}: $${x}`)
              .join(", ")}`
        : "";

    cyphers.push(`", { this: ${varName}${apocParams} }, false )`);

    return [cyphers.join("\n"), params];
}

export default createAggregateWhereAndParams;
