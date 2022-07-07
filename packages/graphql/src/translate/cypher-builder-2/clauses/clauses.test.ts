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

import { and, or } from "../operations/boolean";
import { gt, lt, eq } from "../operations/comparison";

import * as CypherBuilder from "../CypherBuilder";

describe("CypherBuilder", () => {
    // it("Match", () => {
    //     const node = new CypherBuilder.Node({ labels: ["Movie"] });

    //     const clause = new CypherBuilder.Match(node)
    //         .where(and(or(gt(1, 2), lt(1, 2)), eq("aa", "bb")))
    //         .return(node, ["title"], "movie");

    //     const queryResult = clause.build();
    //     expect(queryResult.cypher).toMatchInlineSnapshot(`
    //         "MATCH (this0:\`Movie\`)
    //         WHERE ((1 > 2 OR 1 < 2) AND aa = bb)
    //         RETURN this0 {.title} AS movie"
    //     `);

    //     expect(queryResult.params).toMatchInlineSnapshot(`Object {}`);
    // });

    it("Match Where", () => {
        const node = new CypherBuilder.Node({ labels: ["Movie"] });

        const param = new CypherBuilder.Param(1);
        const clause = new CypherBuilder.Match(node)
            .where(
                and(
                    or(gt(param, new CypherBuilder.Param(2)), lt(param, new CypherBuilder.Param(4))),
                    eq(new CypherBuilder.Param("aa"), new CypherBuilder.Param("bb"))
                )
            )
            .return(node, ["title"], "movie");

        const queryResult = clause.build();
        expect(queryResult.cypher).toMatchInlineSnapshot(`
            "MATCH (this0:\`Movie\`)
            WHERE (($param0 > $param1 OR $param0 < $param2) AND $param3 = $param4)
            RETURN this0 {.title} AS movie"
        `);

        expect(queryResult.params).toMatchInlineSnapshot(`
            Object {
              "param0": 1,
              "param1": 2,
              "param2": 4,
              "param3": "aa",
              "param4": "bb",
            }
        `);
    });
});
