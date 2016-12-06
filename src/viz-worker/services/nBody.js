import url from 'url';
import { nBody as createNBody } from '../models';
import { cache as Cache } from '@graphistry/common';
import { Observable, ReplaySubject } from 'rxjs';
import { dataset as createDataset } from 'viz-shared/models/workbooks';

export function loadNBody(nBodiesById) {
    return function loadDatasetNBody({ workbook, options = {} }) {
        const dataset = getCurrentDataset(workbook, options);
        return (dataset.id in nBodiesById) ?
            nBodiesById[dataset.id] : (
            nBodiesById[dataset.id] = Observable
                .of(dataset)
                .map(createNBody)
                .multicast(new ReplaySubject(1))
                .refCount()
                .let((nBodyObs) => nBodyObs.do((nBody) => {
                    nBodiesById[nBody.id] =
                    nBodiesById[dataset.id] = nBodyObs;
                }))
            );
    }
}

export function setLayoutControl(loadViewsById) {
    return function ({ workbookId, viewId, algoName, value, id }) {
        return loadViewsById({
            workbookIds: [workbookId], viewIds: [viewId]
        }).do(({ view }) => {
            const { nBody } = view;
            nBody && nBody.interactions.next({
                play: true, layout: true, simControls: {
                    [algoName]: {
                        [id]: value
                    }
                }
            });
        });
    }
}

function getCurrentDataset(workbook, options) {

    const { datasets } = workbook;

    let datasetsIndex = -1;
    const datasetsLen = datasets.length;
    const datasetName = options.dataset;

    while (++datasetsIndex < datasetsLen) {
        const dataset = datasets[datasetsIndex];
        if (dataset.name === datasetName || datasetName == null) {
            return dataset;
        }
    }

    return datasets[datasetsIndex] || (
           datasets[datasetsIndex] = createDataset(options));
}
