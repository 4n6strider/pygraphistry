import url from 'url';
import { loadDataset } from './datasets';
import { Observable, Scheduler } from 'rxjs';
import Binning from 'viz-worker/simulator/Binning';
import { cache as Cache } from '@graphistry/common';
import { load as _loadVGraph } from '../simulator/libs/VGraphLoader';
import { columns as createColumns } from 'viz-shared/models/columns';
import { histogram as createHistogram } from 'viz-shared/models/expressions';
import {
    ref as $ref,
    atom as $atom,
    pathValue as $value,
    pathInvalidation as $invalidate
} from '@graphistry/falcor-json-graph';

const unpackers = {
    'null': _loadVGraph,
    'vgraph': _loadVGraph,
    'default': _loadVGraph,
    'jsonMeta': loadVGraphJSON
};

export function loadVGraph(view, config, s3Cache) {
    return Observable
        .of({ view, loaded: false })
        .expand(loadAndUnpackVGraph(config, s3Cache))
        .takeLast(1)
        .mergeMap(loadDataFrameAndUpdateBuffers)
}

function loadAndUnpackVGraph(config, s3Cache) {
    return function loadAndUnpackVGraph({ view, loaded }) {

        if (loaded === true) {
            return Observable.empty();
        }

        const { nBody } = view;
        const { dataset } = nBody;
        const unpack = unpackers[dataset.type];

        return loadDataset(dataset, config, s3Cache)
            .map((buffer) => ({ metadata: dataset, body: buffer }))
            .mergeMap(
                (tuple) => unpack(nBody, tuple, config, s3Cache),
                (tuple, nBodyOrTuple) => {
                    let loaded = false;
                    if (nBodyOrTuple.loaded === false) {
                        view.nBody = nBodyOrTuple.nBody;
                    } else {
                        loaded = true;
                        view.nBody = nBodyOrTuple;
                    }
                    return { view, loaded };
                }
            );
    }
}

function loadVGraphJSON(nBody, { metadata: dataset, body: buffer }, config, s3Cache) {
    const json = JSON.parse(buffer.toString('utf8'));
    const datasource = json.datasources[0];
    console.error('JSON-META: ' + JSON.stringify(json));
    nBody.dataset = {
        ...dataset,
        ...json, type: 'vgraph',
        url: url.parse(datasource.url)
    };

    return Observable.of({ nBody, loaded: false })
}

function loadDataFrameAndUpdateBuffers({ view }) {

    const { nBody } = view;
    const { simulator, simulator: { dataframe, layoutAlgorithms }} = nBody;
    // Load into dataframe data attributes that rely on the simulator existing.
    const inDegrees = dataframe.getHostBuffer('backwardsEdges').degreesTyped;
    const outDegrees = dataframe.getHostBuffer('forwardsEdges').degreesTyped;
    const unsortedEdges = dataframe.getHostBuffer('unsortedEdges');

    dataframe.loadDegrees(outDegrees, inDegrees);
    dataframe.loadEdgeDestinations(unsortedEdges);

    // Tell all layout algorithms to load buffers from dataframe, now that
    // we're about to enable ticking
    return Observable.merge(
        ...layoutAlgorithms.map((algo) => Observable.defer(() =>
                algo.updateDataframeBuffers(simulator)
            )
        ),
        Scheduler.async
    )
    .toArray()
    .map(() => {
        view = createInitialHistograms(view, dataframe);
        view.scene = assignHintsToScene(view.scene, dataframe);
        view.columns = createColumns(dataframe.getColumnsByType(true));
        return view;
    });
}

function createInitialHistograms(view, dataframe) {

    const { histograms, histogramsById } = view;

    if (histograms.length) {
        return view;
    }

    const binningInstance = new Binning(dataframe);
    const initialHistograms = binningInstance
        .selectInitialColumnsForBinning(5)
        .map(({ type, dataType, attribute }) => createHistogram({
            name: attribute, dataType, componentType: type
        }));

    histograms.length = initialHistograms.length;

    initialHistograms.forEach((histogram, index) => {
        histogramsById[histogram.id] = histogram;
        histograms[index] = $ref(`${view.absolutePath}
            .histogramsById['${histogram.id}']`);
    });

    return view;
}


function assignHintsToScene(scene, dataframe) {

    // const MAX_SIZE_TO_ALLOCATE = 2000000;
    // const numEdges = dataframe.numEdges();
    // const numPoints = dataframe.numPoints();

    scene.renderer.edges.elements = dataframe.numEdges();//Math.min(numEdges, MAX_SIZE_TO_ALLOCATE);
    scene.renderer.points.elements = dataframe.numPoints();//Math.min(numPoints, MAX_SIZE_TO_ALLOCATE);

    return scene;
}

