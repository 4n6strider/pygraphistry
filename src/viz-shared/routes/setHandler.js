const  { isArray } = Array;
const  { slice } = Array.prototype;

import { inspect } from 'util';
import { Observable } from 'rxjs';
import { mapObjectsToAtoms } from './mapObjectsToAtoms';
import { captureErrorStacks } from './captureErrorStacks';

function defaultValueMapper(node, key, value, path, data) {
    return Observable.of({ path, value: node[key] = value });
}

function defaultPropsResolver(routerInstance) {
    const { request  = {} } = routerInstance;
    const { query = {} } = request;
    return query;
}

export function setHandler(lists, loader, mapValue, valueKeys = {},
                           getInitialProps = defaultPropsResolver) {

    if (typeof mapValue !== 'function') {
        mapValue = defaultValueMapper;
    }

    return function handler(json) {

        const { state, suffix } = getListsAndSuffixes(
            getInitialProps(this) || {}, [], lists, 0, json
        );

        const loaded = suffix.reduce(
            (source, json, index) => source.mergeMap(({ data, idxs }) =>
                expandJSON(json, index, { data, idxs }, valueKeys)),
            Observable
                .defer(() => loader(state))
                .map((data) => ({ data, idxs: { length: 0 } }))
        );

        const values = loaded.mergeMap(({ data, idxs, vals }) => {

            const path = [];
            let index = -1, count = lists.length,
                key, type, pathId = -1, valsId = -1,
                value = data[lists[count - 1]] || data;

            while (++index < count) {
                key = lists[index];
                path[++pathId] = `${key}sById`;
                path[++pathId] = data[key].id;
            }

            index = 0;
            count = idxs.length;

            do {
                if (value.$type) {
                    value = { path, value };
                    break;
                }

                key = idxs[index];
                path[++pathId] = key;

                if (index < count - 1) {
                    value = value[key] || (value[key] = {});
                    continue;
                }

                value = mapValue(value, key, vals, path, data);

            } while (++index < count);

            if (!value || typeof value !== 'object') {
                value = [{ path, value }];
            } else if (typeof value.subscribe !== 'function' && !isArray(value)) {
                if (!value.path) {
                    value = { path, value };
                }
                value = [value];
            }
            return value;
        });

        return (values
            .map(mapObjectsToAtoms)
            // .do((pv) => {
            //     console.log(`set: ${JSON.stringify(json)}`);
            //     console.log(`res: ${JSON.stringify(pv.path)}`);
            // })
            .catch(captureErrorStacks)
        );
    }
}

function getListsAndSuffixes(state, suffix, lists, depth, json) {

    if (!json || json.$type ||
        depth === lists.length ||
        typeof json !== 'object') {
        suffix.push(json);
    } else {

        const list = `${lists[depth]}Ids`;
        const byId = `${lists[depth]}sById`;
        const node = json[byId];

        let keyIdx = -1;
        const keys = state[list] || (state[list] = []);

        for (const key in node) {

            const next = node[key];

            keys[++keyIdx] = key;

            getListsAndSuffixes(state, suffix, lists, depth + 1, next);
        }
    }

    return { state, suffix };
}

function expandJSON(json, index, expansionState, valueKeys = {}) {

    if (!json || json.$type || typeof json !== 'object') {
        return [expansionState];
    }

    const length = index + 1;
    const { data, idxs } = expansionState;

    return mergeMapArray(Object.keys(json), (key) => {
        const nextExpansionState = {
            data,
            vals: json[key],
            idxs: { ...idxs, [index]: key, length }
        };
        if (valueKeys.hasOwnProperty(key)) {
            return [nextExpansionState];
        }
        return expandJSON(json[key], length,
                          nextExpansionState, valueKeys);
    });
}

function mergeMapArray(xs, fn) {
    let ix = -1;
    const list = [];
    const { length } = xs;
    while (++ix < length) {
        list.push.apply(list, fn(xs[ix]));
    }
    return list;
}
