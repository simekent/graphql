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

import type { DocumentNode } from "graphql";
import { gql } from "graphql-tag";
import { Neo4jGraphQL } from "../../../src";
import { formatCypher, formatParams, translateQuery } from "../utils/tck-test-utils";

describe("Cypher Aggregations Int", () => {
    let typeDefs: DocumentNode;
    let neoSchema: Neo4jGraphQL;

    beforeAll(() => {
        typeDefs = gql`
            type Movie {
                imdbRating: Int!
            }
        `;

        neoSchema = new Neo4jGraphQL({
            typeDefs,
        });
    });

    test("Min", async () => {
        const query = gql`
            {
                moviesAggregate {
                    imdbRating {
                        min
                    }
                }
            }
        `;

        const result = await translateQuery(neoSchema, query);

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "CALL {
                MATCH (this:Movie)
                RETURN { min: min(this.imdbRating) } AS var0
            }
            RETURN { imdbRating: var0 }"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`"{}"`);
    });

    test("Max", async () => {
        const query = gql`
            {
                moviesAggregate {
                    imdbRating {
                        max
                    }
                }
            }
        `;

        const result = await translateQuery(neoSchema, query);

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "CALL {
                MATCH (this:Movie)
                RETURN { max: max(this.imdbRating) } AS var0
            }
            RETURN { imdbRating: var0 }"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`"{}"`);
    });

    test("Average", async () => {
        const query = gql`
            {
                moviesAggregate {
                    imdbRating {
                        average
                    }
                }
            }
        `;

        const result = await translateQuery(neoSchema, query);

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "CALL {
                MATCH (this:Movie)
                RETURN { average: avg(this.imdbRating) } AS var0
            }
            RETURN { imdbRating: var0 }"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`"{}"`);
    });

    test("Sum", async () => {
        const query = gql`
            {
                moviesAggregate {
                    imdbRating {
                        sum
                    }
                }
            }
        `;

        const result = await translateQuery(neoSchema, query);

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "CALL {
                MATCH (this:Movie)
                RETURN { sum: sum(this.imdbRating) } AS var0
            }
            RETURN { imdbRating: var0 }"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`"{}"`);
    });

    test("Min, Max, Sum and Average", async () => {
        const query = gql`
            {
                moviesAggregate {
                    imdbRating {
                        min
                        max
                        average
                        sum
                    }
                }
            }
        `;

        const result = await translateQuery(neoSchema, query);

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "CALL {
                MATCH (this:Movie)
                RETURN { min: min(this.imdbRating), max: max(this.imdbRating), average: avg(this.imdbRating), sum: sum(this.imdbRating) } AS var0
            }
            RETURN { imdbRating: var0 }"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`"{}"`);
    });
});
