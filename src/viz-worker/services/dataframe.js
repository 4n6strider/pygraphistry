import { Observable } from 'rxjs';
import { logger as commonLogger } from '@graphistry/common';
import { columns as createColumns } from 'viz-shared/models/columns';
import ExpressionCodeGenerator from 'viz-worker/simulator/expressionCodeGenerator';
const logger = commonLogger.createLogger('viz-worker/services/dataframe.js');

export function appendColumn({ view, componentType, name, values, dataType }) {
    const { nBody } = view;
    const { dataframe } = nBody;
    return (view.columns = createColumns(dataframe
        .addClientProvidedColumn(componentType, name, values, dataType)
        .getColumnsByType(true)
    ));
}

export function tickLayout({ view }) {
    const { nBody } = view;
    nBody.interactions.next({
        play: true, layout: true
    });
    return Observable.empty();
}

export function maskDataframe({ view }) {

    const { nBody } = view;
    const { expressionsById } = view;
    const { dataframe, simulator } = nBody;

    const { selectionMasks, exclusionMasks, limits, errors } =
        groupExpressionsByTypeWithLimitsAndErrors({ dataframe, expressionsById });

    const applyMasksAndEmitUpdatedBuffers = Observable.defer(() => {

        // Prune out dangling edges.
        const prunedMasks = dataframe
            .pruneMaskEdges(dataframe
                .composeMasks(selectionMasks, exclusionMasks, limits));

        const updatedBuffersFromApplyingPrunedMasks = dataframe
            .applyDataframeMaskToFilterInPlace(prunedMasks, simulator);

        if (!view.pruneOrphans) {
            return updatedBuffersFromApplyingPrunedMasks;
        }

        return Observable
            .from(updatedBuffersFromApplyingPrunedMasks)
            .mergeMap(
                (updatedBuffers) => {
                    const orphanPrunedMasks = dataframe.pruneOrphans(prunedMasks);
                    const updatedBuffersFromApplyingOrphanPrunedMasks = dataframe
                        .applyDataframeMaskToFilterInPlace(orphanPrunedMasks, simulator);
                    return updatedBuffersFromApplyingOrphanPrunedMasks;
                },
                (updatedBuffers, pruneUpdatedBuffers) => {
                    // We check return value to see if we should update buffers on the client.
                    // Because this is a cascade of 2 filters, we need to return whether either of them should update
                    return pruneUpdatedBuffers || updatedBuffers;
                }
            );
    });

    return applyMasksAndEmitUpdatedBuffers
        .mergeMap(updateLayoutDataframeBuffers)
        .do(tickSimulatorAndNotifyVBOLoop)
        .mergeMap((updatedBuffers) => {
            if (errors && errors.length > 0) {
                return Observable.throw(errors);
            }
            return Observable.of({ view });
        });

    function updateLayoutDataframeBuffers(updatedBuffers) {
        if (updatedBuffers !== false) {
            logger.trace('Updating layoutAlgorithms after dataframe mask');
            const { layoutAlgorithms } = simulator;
            return Observable.merge(
                ...layoutAlgorithms.map((algo) =>
                    Observable.from(algo.updateDataframeBuffers(simulator))
                )
            )
            .toArray()
            .mapTo(updatedBuffers);
        }
        return Observable.of(updatedBuffers);
    }

    function tickSimulatorAndNotifyVBOLoop(updatedBuffers) {
        if (updatedBuffers !== false) {
            logger.trace('ticking simulator buffers after dataframe mask');
            simulator.tickBuffers([
                'curPoints', 'pointSizes', 'pointColors',
                'edgeColors', 'logicalEdges', 'springsPos'
            ]);
            const { server } = nBody;
            if (server) {
                // we don't have to do this -- nice
                // if (server.viewConfig) {
                //     server.viewConfig.next(view);
                // }
                if (server.ticksMulti) {
                    logger.trace('updating ticksMulti Subject');
                    server.ticksMulti.next(nBody);
                }
            }
        } else {
            logger.trace('no buffers to update after dataframe mask');
        }
    }
}

function groupExpressionsByTypeWithLimitsAndErrors({ dataframe, expressionsById }) {

    const limits = { edge: Infinity, point: Infinity };
    const selectionMasks = [], exclusionMasks = [], errors = [];
    const codeGenerator = new ExpressionCodeGenerator('javascript');

    for (const expressionId in expressionsById) {

        const expression = expressionsById[expressionId];

        if (!expression || !expressionsById.hasOwnProperty(expressionId)) {
            continue;
        }

        const { query, enabled } = expression;

        if (query === undefined || !enabled) {
            continue;
        }

        const { identifier, componentType, expressionType } = expression;

        if (expressionType === 'filter') {

            const { ast } = query;

            if (ast && ast.value !== undefined &&
                ast.type === 'LimitExpression') {
                limits.edge =
                limits.point = codeGenerator.evaluateExpressionFree(ast.value);
                continue;
            }
        }

        const expressionQuery = {
            ...query,
            type: componentType,
            attribute: identifier
        };

        const masks = dataframe.getMasksForQuery(expressionQuery, errors);

        if (masks !== undefined) {
            masks.setExclusive(expressionType === 'exclusion');
            // Record the size of the filtered set for UI feedback:
            expression.maskSizes = masks.maskSize();
            (expressionType === 'filter' ?
                selectionMasks : exclusionMasks
            ).push(masks);
        }
    }

    return { selectionMasks, exclusionMasks, limits, errors };
}
