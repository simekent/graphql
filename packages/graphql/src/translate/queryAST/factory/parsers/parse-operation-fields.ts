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

import type { ConcreteEntityAdapter } from "../../../../schema-model/entity/model-adapters/ConcreteEntityAdapter";
import type { InterfaceEntityAdapter } from "../../../../schema-model/entity/model-adapters/InterfaceEntityAdapter";

export type OperationFieldMatch = {
    isRead: boolean;
    isConnection: boolean;
    isAggregation: boolean;
    isCreate: boolean;
};

export function parseOperationField(field: string, entityAdapter: ConcreteEntityAdapter): OperationFieldMatch {
    const rootTypeFieldNames = entityAdapter.operations.rootTypeFieldNames;
    return {
        isRead: field === rootTypeFieldNames.read,
        isConnection: field === rootTypeFieldNames.connection,
        isAggregation: field === rootTypeFieldNames.aggregate,
        isCreate: field === rootTypeFieldNames.create,
    };
}

export function parseInterfaceOperationField(
    field: string,
    entityAdapter: InterfaceEntityAdapter
): OperationFieldMatch {
    const rootTypeFieldNames = entityAdapter.operations.rootTypeFieldNames;
    return {
        isRead: field === rootTypeFieldNames.read,
        isConnection: false, //connection not supported as interface top-level operation
        isAggregation: field === rootTypeFieldNames.aggregate,
        isCreate: field === rootTypeFieldNames.create,
    };
}
