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

import { compileCypher } from "../../utils/compile-cypher";
import { wrapApocConvertDate } from "../projection/elements/create-datetime-element";
import { stringifyObject } from "../utils/stringify-object";
import Cypher from "@neo4j/cypher-builder";
import { dedent } from "graphql-compose";

export function createMatchWherePattern(
    matchPattern: Cypher.Pattern,
    preComputedWhereFields: Cypher.CompositeClause | undefined,
    wherePredicate: Cypher.Predicate | undefined
): Cypher.Clause {
    const matchClause = new Cypher.Match(matchPattern);
    const whereClause = preComputedWhereFields && !preComputedWhereFields?.empty ? new Cypher.With("*") : matchClause;
    if (wherePredicate) whereClause.where(wherePredicate);
    return preComputedWhereFields && !preComputedWhereFields?.empty
        ? Cypher.concat(matchClause, preComputedWhereFields, whereClause)
        : matchClause;
}

export function stringAggregationQuery(
    matchWherePattern: Cypher.Clause,
    fieldName: string,
    fieldRef: Cypher.Variable,
    targetAlias: Cypher.Node | Cypher.Relationship
): Cypher.Clause {
    const fieldPath = targetAlias.property(fieldName);

    return new Cypher.Raw((env) => {
        const targetAliasCypher = compileCypher(targetAlias, env);
        const fieldPathCypher = compileCypher(fieldPath, env);

        return dedent`${compileCypher(matchWherePattern, env)}
        WITH ${targetAliasCypher}
        ORDER BY size(${fieldPathCypher}) DESC
        WITH collect(${fieldPathCypher}) AS list
        RETURN { longest: head(list), shortest: last(list) } AS ${compileCypher(fieldRef, env)}`;
    });
}

export function numberAggregationQuery(
    matchWherePattern: Cypher.Clause,
    fieldName: string,
    fieldRef: Cypher.Variable,
    targetAlias: Cypher.Node | Cypher.Relationship
): Cypher.Raw {
    const fieldPath = targetAlias.property(fieldName);
    return new Cypher.Raw((env) => {
        const fieldPathCypher = compileCypher(fieldPath, env);

        return dedent`${compileCypher(matchWherePattern, env)}
        RETURN { min: min(${fieldPathCypher}), max: max(${fieldPathCypher}), average: avg(${fieldPathCypher}), sum: sum(${fieldPathCypher}) }  AS ${compileCypher(
            fieldRef,
            env
        )}`;
    });
}

export function defaultAggregationQuery(
    matchWherePattern: Cypher.Clause,
    fieldName: string,
    fieldRef: Cypher.Variable,
    targetAlias: Cypher.Node | Cypher.Relationship
): Cypher.Raw {
    const fieldPath = targetAlias.property(fieldName);
    return new Cypher.Raw((env) => {
        const fieldPathCypher = compileCypher(fieldPath, env);

        return dedent`${compileCypher(matchWherePattern, env)}
        RETURN { min: min(${fieldPathCypher}), max: max(${fieldPathCypher}) } AS ${compileCypher(fieldRef, env)}`;
    });
}

export function dateTimeAggregationQuery(
    matchWherePattern: Cypher.Clause,
    fieldName: string,
    fieldRef: Cypher.Variable,
    targetAlias: Cypher.Node | Cypher.Relationship
): Cypher.Raw {
    const fieldPath = targetAlias.property(fieldName);
    return new Cypher.Raw((env) => {
        const fieldPathCypher = compileCypher(fieldPath, env);
        return dedent`${compileCypher(matchWherePattern, env)}
        RETURN ${stringifyObject({
            min: new Cypher.Raw(wrapApocConvertDate(`min(${fieldPathCypher})`)),
            max: new Cypher.Raw(wrapApocConvertDate(`max(${fieldPathCypher})`)),
        }).getCypher(env)} AS ${compileCypher(fieldRef, env)}`;
    });
}
