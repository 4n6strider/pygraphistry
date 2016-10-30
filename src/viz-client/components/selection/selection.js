import classNames from 'classnames';
import React, { PropTypes } from 'react';
import styles from 'viz-shared/components/selection/styles.less';
import {
    Subject, Observable,
    Subscription, ReplaySubject
} from 'rxjs';

import {
    curPoints,
    pointSizes,
    cameraChanges
} from 'viz-client/legacy';

import {
    compose,
    getContext,
    shallowEqual,
    mapPropsStream
} from 'recompose';

const SelectionArea = ({ mask, renderState, ...props }) => {
    if (!mask || !renderState) {
        return null;
    }
    let { tl = {}, br = {} } = mask;
    const { camera, canvas } = renderState;
    tl = camera.canvasCoords(tl.x || 0, tl.y || 0, canvas);
    br = camera.canvasCoords(br.x || 0, br.y || 0, canvas);
    return (
        <div style={{
                 width: (br.x - tl.x) || 0,
                 height: (br.y - tl.y) || 0,
                 transform: `translate3d(${
                    tl.x || 0}px, ${
                    tl.y || 0}px, 0)`
             }}
             className={classNames({
                 [styles['draggable']]: true,
                 [styles['selection-area']]: true
             })}
             { ...props }
        />
    );
}

const HighlightPoint = ({ index, sizes, points, renderState, onPointSelected }) => {

    if (index === undefined) {
        return null;
    }

    const camera = renderState.camera;
    const isDraggable = !!onPointSelected;
    const scalingFactor = camera.semanticZoom(sizes.length);
    const { x, y } = camera.canvasCoords(points[2 * index],
                                         points[2 * index + 1],
                                         renderState.canvas,
                                         camera.getMatrix());

    // Clamp like in pointculled shader
    const size = Math.max(5, Math.min(
        scalingFactor * sizes[index], 50)) / camera.pixelRatio;

    const hitArea = Math.max(50, size * 2);
    const hitAreaRatio = size / hitArea;

    return (
        <div className={classNames({
                [styles['draggable']]: isDraggable,
                [styles['selection-point']]: true,
             })}
             onMouseDown={onPointSelected}
             onTouchStart={onPointSelected}
             style={{
                 width: `${hitArea}px`,
                 height: `${hitArea}px`,
                 transform: `translate3d(${
                    (x - (hitArea * 0.5))}px, ${
                    (y - (hitArea * 0.5))}px, 0)`
             }}>
             <div className={styles['selection-point-center']}
                  style={{
                      borderRadius: size * 0.5,
                      width: size, height: size,
                      transform: `translate3d(${
                         ((hitArea - size) * 0.5)}px, ${
                         ((hitArea - size) * 0.5)}px, 0)`
                  }}/>
        </div>
    );
}

const WithPointsAndSizes = mapPropsStream((props) => props.combineLatest(
    pointSizes.map(({ buffer }) => new Uint8Array(buffer)),
    curPoints.map(({ buffer }) => new Float32Array(buffer)),
    cameraChanges.startWith({}),
    Observable.fromEvent(window, 'resize')
              .debounceTime(100)
              .delay(50).startWith(null),
    (props, sizes, points) => ({ ...props, sizes, points })
));

const Selection = compose(
    getContext({
        renderState: PropTypes.object,
        renderingScheduler: PropTypes.object,
    }),
    WithPointsAndSizes
)(({ mask,
     simulating,
     sizes, points,
     point: pointIndexes = [],
     onSelectedPointTouchStart,
     onSelectionMaskTouchStart,
     renderState, renderingScheduler,
     highlight: { point: highlightPoints = [] } = {} }) => {

    if (simulating || !renderState || !renderingScheduler) {
        highlightPoints = [];
        renderState = undefined;
        renderingScheduler = undefined;
        onSelectedPointTouchStart = undefined;
        onSelectionMaskTouchStart = undefined;
    }

    const highlightedPoint = highlightPoints[0];

    onMaskTouchStart.mask = mask;
    onMaskTouchStart.simulating = simulating;
    onMaskTouchStart.renderState = renderState;
    onMaskTouchStart.dispatch = onSelectionMaskTouchStart;
    onMaskTouchStart.renderingScheduler = renderingScheduler;

    onPointTouchStart.simulating = simulating;
    onPointTouchStart.renderState = renderState;
    onPointTouchStart.selectedPoints = pointIndexes;
    onPointTouchStart.highlightedPoint = highlightedPoint;
    onPointTouchStart.dispatch = onSelectedPointTouchStart;
    onPointTouchStart.renderingScheduler = renderingScheduler;

    return (
        <div style={{
            width: `100%`,
            height: `100%`,
            position: `absolute`,
            background: `transparent` }}>
            <HighlightPoint key='highlight-point'
                            index={highlightedPoint}
                            renderState={renderState}
                            sizes={sizes} points={points}
                            onPointSelected={onPointTouchStart}/>
            <SelectionArea mask={mask}
                           key='selection-mask'
                           renderState={renderState}
                           onMouseDown={onMaskTouchStart}
                           onTouchStart={onMaskTouchStart}/>
        </div>
    );
});

export { Selection };

function onMaskTouchStart(event) {

    const { mask,
            dispatch,
            simulating,
            renderState,
            renderingScheduler } = onMaskTouchStart;

    if (simulating ||
        !dispatch ||
        !renderState ||
        !renderingScheduler) {
        return;
    }

    dispatch({
        rect: mask, event,
        renderingScheduler,
        selectionMask: mask,
        selectionType: 'window',
        simulating, renderState,
        camera: renderState.camera
    });
}

function onPointTouchStart(event) {

    const { dispatch,
            simulating,
            renderState,
            selectedPoints,
            highlightedPoint,
            renderingScheduler } = onPointTouchStart;

    if (simulating ||
        !dispatch ||
        !renderState ||
        !renderingScheduler ||
        !selectedPoints.length ||
        (highlightedPoint === undefined) || !(
        ~selectedPoints.indexOf(highlightedPoint))) {
        return;
    }

    dispatch({
        event,
        renderingScheduler,
        selectionType: 'select',
        simulating, renderState,
        camera: renderState.camera,
        pointIndexes: selectedPoints,
    });
}
