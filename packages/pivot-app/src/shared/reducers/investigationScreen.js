import { $ref, $value } from '@graphistry/falcor-json-graph';
import { combineEpics } from 'redux-observable';
import { Observable } from 'rxjs';
import {
    SELECT_INVESTIGATION,
    CREATE_INVESTIGATION,
    SET_INVESTIGATION_PARAMS,
    SAVE_INVESTIGATION,
    COPY_INVESTIGATION,
    DELETE_INVESTIGATIONS
} from '../actions/investigationScreen.js';


export const investigationScreen = combineEpics(
    createInvestigation, selectInvestigation, setInvestigationParams,
    saveInvestigation, copyInvestigation, deleteInvestigations
);

function createInvestigation(action$) {
    return action$
        .ofType(CREATE_INVESTIGATION)
        .mergeMap(({falcor}) => falcor.call('createInvestigation'))
        .ignoreElements();
}

function selectInvestigation(action$) {
    return action$
        .ofType(SELECT_INVESTIGATION)
        .groupBy(({ id }) => id)
        .mergeMap((actionsById) => actionsById.switchMap(
            ({ falcor, id }) => falcor.set({
                json: {
                    currentUser: {
                        activeInvestigation: $ref(`investigationsById['${id}']`)
                    }
                }
            })
            .progressively()
        ))
        .ignoreElements();
}

function setInvestigationParams(action$) {
    return action$
        .ofType(SET_INVESTIGATION_PARAMS)
        .switchMap(({ falcor, params, id }) =>
            falcor.set(...Object.keys(params).map((key) => $value(
                `investigations['${id}']['${key}']`, params[key]
            ))).progressively()
        )
        .ignoreElements();
}

function saveInvestigation(action$) {
    return action$
        .ofType(SAVE_INVESTIGATION)
        .mergeMap(({falcor}) =>
            Observable.from(falcor.call('save'))
        )
        .ignoreElements();
}

function copyInvestigation(action$) {
    return action$
        .ofType(COPY_INVESTIGATION)
        .mergeMap(({falcor}) =>
            Observable.from(falcor.call('clone'))
        )
        .ignoreElements();
}

function deleteInvestigations(action$) {
    return action$
        .ofType(DELETE_INVESTIGATIONS)
        .mergeMap(({falcor, investigationIds}) =>
            Observable.from(
                falcor.call('removeInvestigations', [investigationIds])
            )
        )
        .ignoreElements();
}
