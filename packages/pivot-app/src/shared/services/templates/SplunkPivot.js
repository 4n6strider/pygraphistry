import _ from 'underscore';
import { Observable } from 'rxjs';
import moment from 'moment';
import { PivotTemplate } from './template.js';
import { splunkConnector0 } from '../connectors';
import { shapeSplunkResults } from '../shapeSplunkResults.js';
import logger from '../../../shared/logger.js';
const log = logger.createLogger(__filename);


export class SplunkPivot extends PivotTemplate {
    constructor( pivotDescription ) {
        super(pivotDescription);

        const { toSplunk, connections, encodings, attributes } = pivotDescription;
        this.toSplunk = toSplunk;
        this.connections = connections;
        this.encodings = encodings;
        this.attributes = attributes;
        this.connector = splunkConnector0;
    }

    searchAndShape({ app, pivot, pivotCache }) {

        const {searchQuery, searchParams} = this.toSplunk(pivot.pivotParameters, pivotCache);
        pivot.template = this;

        if (!pivot.enabled) {
            pivot.resultSummary = {};
            pivot.resultCount = 0;
            return Observable.of({ app, pivot });
        } else {

            return this.connector.search(searchQuery, searchParams)
                .do(({ resultCount, events, searchId, df, isPartial }) => {
                    pivot.df = df;
                    pivot.resultCount = resultCount;
                    pivot.events = events;
                    pivot.splunkSearchId = searchId;
                    pivot.isPartial = isPartial;
                    pivotCache[pivot.id] = {
                        results: pivot.results,
                        query: searchQuery,
                        splunkSearchId: pivot.splunkSearchId
                    };
                })
                .map(() => shapeSplunkResults({app, pivot}));
        }
    }

    dayRangeToSplunkParams({ startDate, endDate }) {
        if (startDate && endDate) {
            const startDay = moment(startDate).startOf('day');
            const endDay = moment(endDate).startOf('day');

            return {
                'earliest_time': startDay.unix(),
                'latest_time': endDay.unix(),
            };
        } else {
            log.warn('Got undefined day range, cannot convert to Splunk params');
            return undefined;
        }
    }

    //Assumes previous pivots have populated pivotCache
    expandTemplate(text, pivotCache) {
        log.debug({toExpand: text}, 'Expanding');
        return buildLookup(text, pivotCache);
    }

    constructFieldString() {
        const fields = (this.connections || []).concat(this.attributes || []);
        if (fields.length > 0) {
            return `| rename _cd as EventID
                    | eval c_time=strftime(_time, "%Y-%d-%m %H:%M:%S")
                    | fields "c_time" as time, "EventID", "${fields.join('","')}" | fields - _*`;
        } else { // If there are no fields, load all
            return `| rename _cd as EventID
                    | eval c_time=strftime(_time, "%Y-%d-%m %H:%M:%S")
                    | rename "c_time" as time | fields * | fields - _*`;
        }
    }
}

function buildLookup(text, pivotCache) {

    //Special casing of [search] -[field]-> [source]
    //   search can be "{{pivot###}}""
    //   field can be  "field1, field2,field3, ..."
    //   source is any search
    const hit = text.match(/\[{{(.*)}}] *-\[(.*)]-> *\[(.*)]/);
    if (hit) {
        const search = hit[1];
        const fields = hit[2].split(',')
            .map(s => s.trim())
            .map(s => s[0] === '"' ? s.slice(1,-1).trim() : s);
        const source = hit[3];

        log.trace({search, fields, source}, 'Looking at');
        let match = '';
        for (let i = 0; i < fields.length; i++) {
            const field = fields[i];
            const vals = _.uniq(_.map(pivotCache[search].events, function (row) {
                return row[field];
            }));
            const fieldMatch = `"${ field }"="${ vals.join(`" OR "${ field }"="`) }"`;
            match = match + (match ? ' OR ' : '') + fieldMatch;
        }
        return `${ source } ${ match } | head 10000 `;
    } else {
        return undefined;
    }
}
