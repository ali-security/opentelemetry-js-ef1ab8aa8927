/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import {
  Baggage,
  BaggageEntry,
  BaggageEntryMetadata,
  baggageEntryMetadataFromString,
} from '@opentelemetry/api';
import {
  BAGGAGE_ITEMS_SEPARATOR,
  BAGGAGE_PROPERTIES_SEPARATOR,
  BAGGAGE_KEY_PAIR_SEPARATOR,
  BAGGAGE_MAX_TOTAL_LENGTH,
  BAGGAGE_MAX_NAME_VALUE_PAIRS,
  BAGGAGE_MAX_PER_NAME_VALUE_PAIRS,
} from './constants';

type ParsedBaggageKeyValue = {
  key: string;
  value: string;
  metadata: BaggageEntryMetadata | undefined;
};

export function serializeKeyPairs(keyPairs: string[]): string {
  return keyPairs.reduce((hValue: string, current: string) => {
    const value = `${hValue}${
      hValue !== '' ? BAGGAGE_ITEMS_SEPARATOR : ''
    }${current}`;
    return value.length > BAGGAGE_MAX_TOTAL_LENGTH ? hValue : value;
  }, '');
}

export function getKeyPairs(baggage: Baggage): string[] {
  return baggage.getAllEntries().map(([key, value]) => {
    let entry = `${encodeURIComponent(key)}=${encodeURIComponent(value.value)}`;

    // include opaque metadata if provided
    // NOTE: we intentionally don't URI-encode the metadata - that responsibility falls on the metadata implementation
    if (value.metadata !== undefined) {
      entry += BAGGAGE_PROPERTIES_SEPARATOR + value.metadata.toString();
    }

    return entry;
  });
}

export function parsePairKeyValue(
  entry: string
): ParsedBaggageKeyValue | undefined {
  const valueProps = entry.split(BAGGAGE_PROPERTIES_SEPARATOR);
  if (valueProps.length <= 0) return;
  const keyPairPart = valueProps.shift();
  if (!keyPairPart) return;
  const separatorIndex = keyPairPart.indexOf(BAGGAGE_KEY_PAIR_SEPARATOR);
  if (separatorIndex <= 0) return;
  const key = decodeURIComponent(
    keyPairPart.substring(0, separatorIndex).trim()
  );
  const value = decodeURIComponent(
    keyPairPart.substring(separatorIndex + 1).trim()
  );
  let metadata;
  if (valueProps.length > 0) {
    metadata = baggageEntryMetadataFromString(
      valueProps.join(BAGGAGE_PROPERTIES_SEPARATOR)
    );
  }
  return { key, value, metadata };
}

/**
 * Parses a single baggage header string into the provided record, applying limits defined in this package.
 * Uses indexOf/substring in a while loop to avoid allocating a full array of split entries.
 * Returns the updated pair count so callers can track totals across multiple header values.
 */
export function parseBaggageHeaderString(
  value: string,
  baggage: Record<string, BaggageEntry>,
  count: number,
  totalSize: number
): [count: number, totalSize: number] {
  let start = 0;
  while (start < value.length && count < BAGGAGE_MAX_NAME_VALUE_PAIRS) {
    const end = value.indexOf(BAGGAGE_ITEMS_SEPARATOR, start);
    const entryEnd = end === -1 ? value.length : end;
    const entryLength = entryEnd - start;

    if (entryLength <= BAGGAGE_MAX_PER_NAME_VALUE_PAIRS) {
      const keyPair = parsePairKeyValue(value.substring(start, entryEnd));
      if (keyPair) {
        // Comma separator is counted for every accepted entry after the first
        const entrySize = (count === 0 ? 0 : 1) + entryLength;
        if (totalSize + entrySize > BAGGAGE_MAX_TOTAL_LENGTH) break;
        baggage[keyPair.key] = keyPair.metadata
          ? { value: keyPair.value, metadata: keyPair.metadata }
          : { value: keyPair.value };
        count++;
        totalSize += entrySize;
      }
    }

    if (end === -1) break;
    start = end + 1;
  }
  return [count, totalSize];
}

/**
 * Parse a string serialized in the baggage HTTP Format (without metadata):
 * https://github.com/w3c/baggage/blob/master/baggage/HTTP_HEADER_FORMAT.md
 */
export function parseKeyPairsIntoRecord(
  value?: string
): Record<string, string> {
  if (typeof value !== 'string' || value.length === 0) return {};
  return value
    .split(BAGGAGE_ITEMS_SEPARATOR)
    .map(entry => {
      return parsePairKeyValue(entry);
    })
    .filter(keyPair => keyPair !== undefined && keyPair.value.length > 0)
    .reduce<Record<string, string>>((headers, keyPair) => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      headers[keyPair!.key] = keyPair!.value;
      return headers;
    }, {});
}
