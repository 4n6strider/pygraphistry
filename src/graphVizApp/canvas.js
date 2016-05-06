'use strict';

var debug   = require('debug')('graphistry:StreamGL:graphVizApp:canvas');
var $       = window.$;
var Rx      = require('rxjs/Rx');
              require('../rx-jquery-stub');
var _       = require('underscore');

var interaction     = require('./interaction.js');
var util            = require('./util.js');
var renderer        = require('../renderer');
var colorPicker     = require('./colorpicker.js');
var VizSlice        = require('./VizSlice.js');


function setupCameraInteractions(appState, $eventTarget) {
    var renderState = appState.renderState;
    var camera = renderState.get('camera');
    var canvas = renderState.get('canvas');

    //pan/zoom
    //Observable Event
    var interactions;
    if (interaction.isTouchBased) {
        debug('Detected touch-based device. Setting up touch interaction event handlers.');
        var eventTarget = $eventTarget[0];
        interactions = interaction.setupSwipe(eventTarget, camera)
            .merge(
                interaction.setupPinch($eventTarget, camera)
                    .switchMap(util.observableFilter(appState.anyMarqueeOn, util.notIdentity)));
    } else {
        debug('Detected mouse-based device. Setting up mouse interaction event handlers.');
        interactions = interaction.setupDrag($eventTarget, camera, appState)
            .merge(interaction.setupScroll($eventTarget, canvas, camera, appState));
    }

    setupKeyInteractions(appState, $eventTarget);

    return Rx.Observable.merge(
        interactions,
        interaction.setupRotate($eventTarget, camera),
        interaction.setupCenter($('#center'),
                                renderState.get('hostBuffers').curPoints,
                                camera),
        interaction.setupZoomButton($('#zoomin'), camera, 1 / 1.25)
            .switchMap(util.observableFilter(appState.anyMarqueeOn, util.notIdentity)),
        interaction.setupZoomButton($('#zoomout'), camera, 1.25)
            .switchMap(util.observableFilter(appState.anyMarqueeOn, util.notIdentity))
    );
}

function setupKeyInteractions(appState, $eventTarget) {
    // Deselect on escape;
    $eventTarget.keyup(function (evt) {
        var ESC_KEYCODE = 27;
        if (evt.keyCode === ESC_KEYCODE) {
            appState.activeSelection.onNext(new VizSlice({point: [], edge: []}));
        }
    });

}

function setupCameraInteractionRenderUpdates(renderingScheduler, cameraStream, settingsChanges, simulateOn) {
    const interactionRenderDelay = 200;
    var timeOutFunction;

    var renderFullIfNotSimulating = function () {
        simulateOn.take(1).do(function (simulateIsOn) {
            if (!simulateIsOn) {
                renderingScheduler.renderScene('panzoom', {trigger: 'renderSceneFull'});
                timeOutFunction = null;
            }
        }).subscribe(_.identity, util.makeErrorHandler('rendering full from camera interactions'));
    };

    var resetDelayedFullRender = function () {
        // Clear previously set timeout if it exists
        if (timeOutFunction) {
            clearTimeout(timeOutFunction);
        }

        // Request new timeout
        timeOutFunction = setTimeout(renderFullIfNotSimulating, interactionRenderDelay);
    };

    settingsChanges
        .combineLatest(cameraStream, _.identity)
        .do(function () {
            resetDelayedFullRender();
            renderingScheduler.renderScene('panzoom', {trigger: 'renderSceneFast'});
        }).subscribe(_.identity, util.makeErrorHandler('render updates'));
}

function setupBackgroundColor(renderingScheduler, bgColor) {
    bgColor.do(function (color) {
        renderingScheduler.renderState.get('options').clearColor = [colorPicker.renderConfigValueForColor(color)];
        renderingScheduler.renderScene('bgcolor', {trigger: 'renderSceneFast'});
    }).subscribe(_.identity, util.makeErrorHandler('background color updates'));
}

//Find label position (unadjusted and in model space)
//  Currently just picks a midEdge vertex near the ~middle
//  (In contrast, mouseover effects should use the ~Voronoi position)
//  To convert to canvas coords, use Camera (ex: see labels::renderCursor)
//  TODO use camera if edge goes off-screen
//RenderState * int -> {x: float,  y: float}
function getEdgeLabelPos (appState, edgeIndex) {
    var numRenderedSplits = appState.renderState.get('config').get('numRenderedSplits');
    var split = Math.floor(numRenderedSplits/2);

    var appSnapshot = appState.renderingScheduler.appSnapshot;
    var midSpringsPos = appSnapshot.buffers.midSpringsPos;

    var midEdgesPerEdge = numRenderedSplits + 1;
    var midEdgeStride = 4 * midEdgesPerEdge;
    var idx = midEdgeStride * edgeIndex + 4 * split;

    return {x: midSpringsPos[idx], y: midSpringsPos[idx + 1]};
}


function RenderingScheduler (renderState, vboUpdates, vboVersions, hitmapUpdates,
                                  isAnimating, simulateOn, activeSelection, socket) {
    var that = this;
    this.renderState = renderState;
    this.arrayBuffers = {};
    // Remember last task in case you need to rerender mouseovers without an update.
    this.lastMouseoverTask = undefined;

    var config = renderState.get('config').toJS();
    this.attemptToAllocateBuffersOnHints(socket, config, renderState);

    /* Rendering queue */
    var renderTasks = new Rx.Subject();
    var renderQueue = {};
    var renderingPaused = true; // False when the animation loop is running.

    var fullBufferNameList = renderer.getBufferNames(renderState.get('config').toJS())
        .concat(
            //TODO move client-only into render.config dummies when more sane
            ['highlightedEdges', 'highlightedNodePositions', 'highlightedNodeSizes', 'highlightedNodeColors',
             'highlightedArrowStartPos', 'highlightedArrowEndPos', 'highlightedArrowNormalDir',
             'highlightedArrowPointColors', 'highlightedArrowPointSizes', 'selectedEdges', 'selectedNodePositions', 'selectedNodeSizes', 'selectedNodeColors',
             'selectedArrowStartPos', 'selectedArrowEndPos', 'selectedArrowNormalDir',
             'selectedArrowPointColors', 'selectedArrowPointSizes', 'selectedEdgeColors', 'selectedEdgeEnds', 'selectedEdgeStarts']);

    /* Since we cannot read out of Rx streams withing the animation frame, we record the latest
     * value produced by needed rx streams and pass them as function arguments to the quiet state
     * callback. */
    this.appSnapshot = {
        vboUpdated: false,
        simulating: false,
        quietState: false,
        interpolateMidPoints : true,
        fullScreenBufferDirty: true,

        //{ <activeBufferName> -> undefined}
        // Seem to be client-defined local buffers
        buffers:
            _.object(fullBufferNameList.map(function (v) { return [v, undefined]; })),

        bufferComputedVersions:
            _.object(fullBufferNameList.map(function (v) { return [v, -1]; })),

        bufferReceivedVersions:
            _.object(fullBufferNameList.map(function (v) { return [v, -1]; })),

        hitmapUpdates: hitmapUpdates
    };

    Object.seal(this.appSnapshot);
    Object.seal(this.appSnapshot.buffers);


    /* Set up fullscreen buffer for mouseover effects.
     *
     */
    renderer.setupFullscreenBuffer(renderState);

    /*
     * Rx hooks to maintain the appSnapshot up-to-date
     */
    simulateOn.subscribe(function (val) {
        that.appSnapshot.simulating = val;
    }, util.makeErrorHandler('simulate updates'));

    vboUpdates.filter(function (status) {
        return status === 'received';
    }).switchMap(function () {
        var hostBuffers = renderState.get('hostBuffers');

        // FIXME handle selection update buffers here.
        Rx.Observable.combineLatest(hostBuffers.selectedPointIndexes, hostBuffers.selectedEdgeIndexes,
            function (pointIndexes, edgeIndexes) {
                activeSelection.onNext(new VizSlice({point: pointIndexes, edge: edgeIndexes}));
            }).take(1).subscribe(_.identity, util.makeErrorHandler('Getting indexes of selections.'));

        var bufUpdates = ['curPoints', 'logicalEdges', 'edgeColors', 'pointSizes', 'curMidPoints', 'edgeHeights', 'edgeSeqLens'].map(function (bufName) {
            var bufUpdate = hostBuffers[bufName] || Rx.Observable.return();
            return bufUpdate.do(function (data) {
                that.appSnapshot.buffers[bufName] = data;
            });
        });
        return vboVersions
            .zip(bufUpdates[0], bufUpdates[1], bufUpdates[2], bufUpdates[3], bufUpdates[4], bufUpdates[5], bufUpdates[6]);

    }).switchMap(function (zippedArray) {
        var vboVersions = zippedArray[0];

        return simulateOn.map((simulateIsOn) => {
            return {vboVersions, simulateIsOn};
        });

    }).do(function (vboVersionAndSimulateStatus) {
        var {vboVersions, simulateIsOn} = vboVersionAndSimulateStatus;

        _.each(vboVersions, function (buffersByType) {
            _.each(buffersByType, function (versionNumber, name) {
                if (that.appSnapshot.bufferReceivedVersions[name] !== undefined) {
                    that.appSnapshot.bufferReceivedVersions[name] = versionNumber;
                }
            });
        });

        // TODO: This can end up firing renderSceneFull multiple times at the end of
        // a simulation session, since multiple VBOs will continue to come in
        // while simulateIsOn = false
        var triggerToUse = simulateIsOn ? 'renderSceneFast' : 'renderSceneFull';

        that.appSnapshot.vboUpdated = true;
        that.renderScene('vboupdate', {trigger: triggerToUse});
        that.renderScene('vboupdate_picking', {
            items: ['pointsampling'],
            callback: function () {
                hitmapUpdates.onNext();
            }
        });
    }).subscribe(_.identity, util.makeErrorHandler('render vbo updates'));


    /* Push a render task into the renderer queue
     * String * {trigger, items, readPixels, callback} -> () */
    this.renderScene = function(tag, task) {
        renderTasks.onNext({
            tag: tag,
            trigger: task.trigger,
            items: task.items,
            readPixels: task.readPixels,
            callback: task.callback,
            data: task.data
        });
    };

    /* Move render tasks into a tagged dictionary. For each tag, only the latest task
     * is rendered; others are skipped. */
    renderTasks.subscribe(function (task) {
        debug('Queueing frame on behalf of', task.tag);
        renderQueue[task.tag] = task;

        if (renderingPaused) {
            startRenderingLoop();
        }
    });


    /*
     * Helpers to start/stop the rendering loop within an animation frame. The rendering loop
     * stops when idle for a second and starts again at the next render update.
     */
    function startRenderingLoop() {
        var SLOW_EFFECT_DELAY = 125;
        var PAUSE_RENDERING_DELAY = 500;

        var lastRenderTime = 0;
        var quietSignaled = true;

        // Communication between render loops about whether to update lastRenderTime,
        // or to check the delta against it to see if we should render slow effects.
        var shouldUpdateRenderTime = true;

        function loop() {
            var nextFrameId = window.requestAnimationFrame(loop);

            // Nothing to render
            if (_.keys(renderQueue).length === 0) {

                // TODO: Generalize this
                if (!quietSignaled) {
                    quietSignaled = true;
                    isAnimating.onNext(false);
                }

                if (shouldUpdateRenderTime) {
                    // Just update render time, leave delta checks for next loop
                    lastRenderTime = Date.now();
                    shouldUpdateRenderTime = false;
                } else {
                    // Check time since last render. Based on duration, pause the rendering loop.
                    var timeDelta = Date.now() - lastRenderTime;

                    if (timeDelta > PAUSE_RENDERING_DELAY) {
                        pauseRenderingLoop(nextFrameId);
                    }

                }

                return;
            }

            // Handle "slow effects request"
            // TODO: Handle this naturally, instead of hack here
            var tagsWithRenderFull = _.filter(_.keys(renderQueue), (key) => {
                var task = renderQueue[key];
                return (task.trigger === 'renderSceneFull');
            });

            if (tagsWithRenderFull.length > 0) {
                // TODO: Generalize this code block
                shouldUpdateRenderTime = true;
                that.appSnapshot.fullScreenBufferDirty = true;
                if (quietSignaled) {
                    isAnimating.onNext(true);
                    quietSignaled = false;
                }

                that.renderSlowEffects();
                that.appSnapshot.vboUpdated = false;
                _.each(tagsWithRenderFull, (tag) => {
                    delete renderQueue[tag];
                });
            }

            // Mouseover interactions
            // TODO: Generalize this as a separate category?
            if (_.keys(renderQueue).indexOf('mouseOver') > -1) {
                // Only handle mouseovers if the fullscreen buffer
                // from rendering all edges (full scene) is clean
                if (!that.appSnapshot.fullScreenBufferDirty) {
                    shouldUpdateRenderTime = true;
                    that.renderMouseoverEffects(renderQueue.mouseOver);
                }
                delete renderQueue.mouseOver;
            }

            // Rest render queue
            if (_.keys(renderQueue).length > 0) {

                // TODO: Generalize this into tag description (or allow to check renderconfig)
                // Alternatively, generalize when we fix the fullScreenBuffer.
                var isRenderingToScreen = _.filter(_.keys(renderQueue),
                    name => name.indexOf('picking') === -1
                ).length > 0;

                // TODO: Generalize this code block
                if (isRenderingToScreen) {
                    shouldUpdateRenderTime = true;
                    that.appSnapshot.fullScreenBufferDirty = true;
                    if (quietSignaled) {
                        isAnimating.onNext(true);
                        quietSignaled = false;
                    }
                }

                renderer.setCamera(renderState);
                _.each(renderQueue, function (renderTask, tag) {
                    renderer.render(renderState, tag, renderTask.trigger, renderTask.items,
                                    renderTask.readPixels, renderTask.callback);
                });
                renderQueue = {};

                // If anything is selected, we need to do the copy to texture + darken
                // TODO: Investigate performance of this.
                if (that.lastMouseoverTask &&
                        (that.lastMouseoverTask.data.selected.nodeIndices.length + that.lastMouseoverTask.data.selected.edgeIndices.length > 0)
                ) {
                    renderer.copyCanvasToTexture(renderState, 'steadyStateTexture');
                    renderer.setupFullscreenBuffer(renderState);
                    that.renderMouseoverEffects();
                }

            }
        }

        debug('Starting rendering loop');
        renderingPaused = false;
        loop();
    }

    function pauseRenderingLoop(nextFrameId) {
        debug('Pausing rendering loop');
        window.cancelAnimationFrame(nextFrameId);
        renderingPaused = true;
    }
}

// Hook to preallocate memory when initial sizes are available.
// We handle these by putting them into an Rx.subject and handling
// each with a 1ms delay in between, to give the JS thread
// some breathing room to handle other callbacks/repaints.
RenderingScheduler.prototype.attemptToAllocateBuffersOnHints = function (socket, config, renderState) {
    var that = this;

    socket.on('sizes_for_memory_allocation', function (numElements) {
        _.extend(numElements, {
            renderedSplits: config.numRenderedSplits
        });
        var allocationFunctions = that.allocateAllArrayBuffersFactory(config, numElements, renderState);

        var largestModel = that.getLargestModelSize(config, numElements);
        var maxElements = Math.max(_.max(_.values(numElements)), largestModel);
        var activeIndices = renderState.get('activeIndices');
        _.each(activeIndices, function (index) {
            allocationFunctions.push(function () {
                renderer.updateIndexBuffer.bind('', renderState, maxElements)(index);
            });
        });

        var timeoutLength = 1;
        var index = 0;
        var process = function () {
            // We've handled everything
            if (index >= allocationFunctions.length) {
                return;
            }

            // Do one big job, then increment
            allocationFunctions[index]();
            index++;

            // Cede control to browser, then handle next element
            setTimeout(process, timeoutLength);
        };
        process();

    });

};



//int * int * Int32Array * Float32Array -> {starts: Float32Array, ends: Float32Array}
//Scatter: label each midEdge with containing edge's start/end pos (used for dynamic culling)
RenderingScheduler.prototype.expandMidEdgeEndpoints = function(numEdges, numRenderedSplits, logicalEdges, curPoints) {

    // var starts = new Float32Array(numEdges * (numRenderedSplits + 1) * 4);
    // var ends = new Float32Array(numEdges * (numRenderedSplits + 1) * 4);

    var starts = this.getTypedArray('midSpringsStarts', Float32Array, numEdges * (numRenderedSplits + 1) * 4);
    var ends = this.getTypedArray('midSpringsEnds', Float32Array, numEdges * (numRenderedSplits + 1) * 4);


    var offset = 0;

    for (var edgeIndex = 0; edgeIndex < numEdges; edgeIndex++) {
        var srcPointIdx = logicalEdges[edgeIndex * 2] * 2;
        var dstPointIdx = logicalEdges[(edgeIndex * 2) + 1] * 2;
        var srcPointX = curPoints[(srcPointIdx)];
        var srcPointY = curPoints[(srcPointIdx)+ 1];
        var dstPointX = curPoints[(dstPointIdx)];
        var dstPointY = curPoints[(dstPointIdx) + 1];

        for (var midPointIdx = 0; midPointIdx < numRenderedSplits + 1; midPointIdx++) {
            starts[offset] = srcPointX;
            starts[offset+1] = srcPointY;
            starts[offset+2] = srcPointX;
            starts[offset+3] = srcPointY;
            ends[offset] = dstPointX;
            ends[offset+1] = dstPointY;
            ends[offset+2] = dstPointX;
            ends[offset+3] = dstPointY;
            offset += 4;
        }

    }

    return {starts: starts, ends: ends};

};


// RenderState
// {logicalEdges: Uint32Array, curPoints: Float32Array, edgeHeights: Float32Array, ?midSpringsPos: Float32Array}
//  * int * float
//  -> {midSpringsPos: Float32Array, midSpringsStarts: Float32Array, midSpringsEnds: Float32Array}
RenderingScheduler.prototype.expandLogicalEdges = function (renderState, bufferSnapshots, numRenderedSplits, edgeHeight) {
    var that = this;
    var logicalEdges = new Uint32Array(bufferSnapshots.logicalEdges.buffer);
    var curPoints = new Float32Array(bufferSnapshots.curPoints.buffer);

    var edgeHeightBuffer = new Uint32Array(bufferSnapshots.edgeHeights.buffer);
    var edgeSeqLenBuffer = new Uint32Array(bufferSnapshots.edgeSeqLens.buffer);

    var numEdges = logicalEdges.length / 2;

    var numVertices = (2 * numEdges) * (numRenderedSplits + 1);

    bufferSnapshots.midSpringsPos = that.getTypedArray('midSpringsPos', Float32Array, numVertices * 2);

    var midSpringsPos = bufferSnapshots.midSpringsPos;
    var midEdgesPerEdge = numRenderedSplits + 1;
    var midEdgeStride = 4 * midEdgesPerEdge;

    var setMidEdge = function (edgeIdx, midEdgeIdx, srcMidPointX, srcMidPointY, dstMidPointX, dstMidPointY) {
        var midEdgeStartIdx = edgeIdx * midEdgeStride;
        var index = midEdgeStartIdx + (midEdgeIdx * 4);
        midSpringsPos[index] = srcMidPointX;
        midSpringsPos[index + 1] = srcMidPointY;
        midSpringsPos[index + 2] = dstMidPointX;
        midSpringsPos[index + 3] = dstMidPointY;
    };

    //for each midEdge, start x/y & end x/y
    var midSpringsEndpoints = that.expandMidEdgeEndpoints(numEdges, numRenderedSplits, logicalEdges, curPoints);

    //TODO have server pre-compute real heights, and use them here
    //var edgeHeights = renderState.get('hostBuffersCache').edgeHeights;
    var srcPointIdx;
    var dstPointIdx;
    var srcPointX;
    var srcPointY;
    var dstPointX;
    var dstPointY;
    // var cosArray = new Float32Array(numRenderedSplits);
    // var sinArray = new Float32Array(numRenderedSplits);
    var heightCounter = 0;
    var prevSrcIdx = -1;
    var prevDstIdx = -1;
    var edgeSeqLen = 1;

    var valueCache = {};
    var getFromCache = function (h, e) {
        if (!valueCache[h]) {
            return undefined;
        }
        return valueCache[h][e];
    };
    var putInCache = function (h, e, val) {
        valueCache[h] = valueCache[h] || {};
        valueCache[h][e] = val;
    };

    for (var edgeIndex = 0; edgeIndex < numEdges; edgeIndex += 1) {

        srcPointIdx = logicalEdges[2 * edgeIndex];
        dstPointIdx = logicalEdges[2 * edgeIndex + 1];
        srcPointX = curPoints[2 * srcPointIdx];
        srcPointY = curPoints[2 * srcPointIdx + 1];
        dstPointX = curPoints[2 * dstPointIdx];
        dstPointY = curPoints[2 * dstPointIdx + 1];

        heightCounter = edgeHeightBuffer[edgeIndex];
        edgeSeqLen = edgeSeqLenBuffer[edgeIndex];

        prevSrcIdx = srcPointIdx;
        prevDstIdx = dstPointIdx;

        var moduloHeight, unitRadius, cosArray, sinArray, midPointIdx;
        var cachedObj = getFromCache(heightCounter, edgeSeqLen);
        if (!cachedObj) {
            // We haven't seen this combo of heightCounter and edgeSeqLen yet.
            moduloHeight = edgeHeight * (1.0 + 2 * heightCounter/edgeSeqLen);
            unitRadius = (1 + Math.pow(moduloHeight, 2)) / (2 * moduloHeight);
            var theta = Math.asin((1 / unitRadius)) * 2;
            var thetaStep = -theta / (numRenderedSplits + 1);

            var curTheta;
            cosArray = new Float32Array(numRenderedSplits);
            sinArray = new Float32Array(numRenderedSplits);
            for (midPointIdx = 0; midPointIdx < numRenderedSplits; midPointIdx++) {
                curTheta = thetaStep * (midPointIdx + 1);
                cosArray[midPointIdx] = Math.cos(curTheta);
                sinArray[midPointIdx] = Math.sin(curTheta);
            }

            cachedObj = {
                moduloHeight: moduloHeight,
                unitRadius: unitRadius,
                theta: theta,
                thetaStep: thetaStep,
                cosArray: cosArray,
                sinArray: sinArray
            };
            putInCache(heightCounter, edgeSeqLen, cachedObj);
        }

        moduloHeight = cachedObj.moduloHeight;
        unitRadius = cachedObj.unitRadius;
        cosArray = cachedObj.cosArray;
        sinArray = cachedObj.sinArray;

        var edgeLength =
            srcPointIdx === dstPointIdx ? 1.0
            : Math.sqrt(Math.pow((dstPointX - srcPointX), 2) + Math.pow((dstPointY - srcPointY), 2));

        var height = moduloHeight * (edgeLength / 2);
        var edgeDirectionX = (srcPointX -  dstPointX) / edgeLength;
        var edgeDirectionY = (srcPointY -  dstPointY) / edgeLength;
        var radius = unitRadius * (edgeLength / 2);
        var midPointX = (srcPointX + dstPointX) / 2;
        var midPointY = (srcPointY + dstPointY) / 2;
        var centerPointX = midPointX + (radius - height) * (-1 * edgeDirectionY);
        var centerPointY = midPointY + (radius - height) * (edgeDirectionX);
        var startRadiusX = srcPointIdx === dstPointIdx ? 1.0 : (srcPointX - centerPointX);
        var startRadiusY = srcPointIdx === dstPointIdx ? 1.0 : (srcPointY - centerPointY);

        var prevPointX = srcPointX;
        var prevPointY = srcPointY;
        var nextPointX;
        var nextPointY;
        for (midPointIdx = 0; midPointIdx < numRenderedSplits; midPointIdx++) {
            var cos = cosArray[midPointIdx];
            var sin = sinArray[midPointIdx];
            nextPointX = centerPointX + (cos * startRadiusX) - (sin * startRadiusY);
            nextPointY = centerPointY + (sin * startRadiusX) + (cos * startRadiusY);
            setMidEdge(edgeIndex, midPointIdx, prevPointX, prevPointY, nextPointX, nextPointY);
            prevPointX = nextPointX;
            prevPointY = nextPointY;
        }
        setMidEdge(edgeIndex, numRenderedSplits,  prevPointX, prevPointY, dstPointX, dstPointY);

    }

    return {
        midSpringsPos: midSpringsPos,
        midSpringsStarts: midSpringsEndpoints.starts,
        midSpringsEnds: midSpringsEndpoints.ends
    };
};



RenderingScheduler.prototype.expandLogicalMidEdges = function (bufferSnapshots) {
    var that = this;
    var logicalEdges = new Uint32Array(bufferSnapshots.logicalEdges.buffer);
    var curMidPoints = new Float32Array(bufferSnapshots.curMidPoints.buffer);
    var curPoints = new Float32Array(bufferSnapshots.curPoints.buffer);
    var numSplits = curMidPoints.length  / logicalEdges.length;

    if (numSplits < 1) {
        numSplits = 0;
    }
    //var numMidEdges = numSplits + 1;
    var numEdges = (logicalEdges.length / 2);

    var numVertices = (2 * numEdges) * (numSplits + 1);


    //for each midEdge, start x/y & end x/y
    var midSpringsEndpoints = that.expandMidEdgeEndpoints(numEdges, numSplits, logicalEdges, curPoints);


    bufferSnapshots.midSpringsPos = that.getTypedArray('midSpringsPos', Float32Array, numVertices * 2);
    var midSpringsPos = bufferSnapshots.midSpringsPos;

    for (var edgeIndex = 0; edgeIndex < numEdges; edgeIndex += 1) {
        var srcPointIdx = logicalEdges[edgeIndex * 2];
        var dstPointIdx = logicalEdges[(edgeIndex * 2) + 1];

        var srcPointX = curPoints[(2 * srcPointIdx)];
        var srcPointY = curPoints[(2 * srcPointIdx)+ 1];
        //var srcPoint = [srcPointX, srcPointY];
        var dstPointX = curPoints[(2 * dstPointIdx)];
        var dstPointY = curPoints[(2 * dstPointIdx) + 1];

        var elementsPerPoint = 2;
        var pointsPerEdge = 2;
        var midEdgesPerEdge = numSplits + 1;
        var midEdgeStride = elementsPerPoint * pointsPerEdge * midEdgesPerEdge;
        var midEdgeStartIdx = edgeIndex * midEdgeStride;

        midSpringsPos[midEdgeStartIdx] =  srcPointX;
        midSpringsPos[midEdgeStartIdx + 1] =  srcPointY;
        var prevX = srcPointX;
        var prevY = srcPointY;

        for (var midEdgeIdx = 0; midEdgeIdx < numSplits; midEdgeIdx++) {

            midSpringsPos[midEdgeStartIdx + (midEdgeIdx * 4)] = prevX;
            midSpringsPos[midEdgeStartIdx + (midEdgeIdx * 4) + 1] = prevY;

            prevX = curMidPoints[(edgeIndex * 2 * (numSplits)) + (midEdgeIdx * 2)];
            prevY = curMidPoints[(edgeIndex * 2 * (numSplits)) + (midEdgeIdx * 2) + 1];

            midSpringsPos[midEdgeStartIdx + (midEdgeIdx * 4) + 2] = prevX;
            midSpringsPos[midEdgeStartIdx + (midEdgeIdx * 4) + 3] = prevY;
        }
        midSpringsPos[((edgeIndex + 1) * midEdgeStride) - 4] =  prevX;
        midSpringsPos[((edgeIndex + 1) * midEdgeStride) - 3] =  prevY;

        midSpringsPos[((edgeIndex + 1) * midEdgeStride) - 2] =  dstPointX;
        midSpringsPos[((edgeIndex + 1) * midEdgeStride) - 1] =  dstPointY;
    }

    return {
        midSpringsPos: midSpringsPos,
        midSpringsStarts: midSpringsEndpoints.starts,
        midSpringsEnds: midSpringsEndpoints.ends
    };
};

/* Populate arrow buffers. The first argument is either an array of indices,
 * or an integer value of how many you want.
 */
RenderingScheduler.prototype.populateArrowBuffers = function (maybeIterable, midSpringsPos, arrowStartPos,
        arrowEndPos, arrowNormalDir, pointSizes, logicalEdges,
        arrowPointSizes, arrowColors, edgeColors, numRenderedSplits) {


    var edgeColors32 = new Uint32Array(edgeColors.buffer);

    var numMidEdges = numRenderedSplits + 1;


    var isIterable = maybeIterable.constructor === Array;
    var forLimit = (isIterable) ? maybeIterable.length : maybeIterable;

    //var start = new Float32Array(2);
    //var end = new Float32Array(2);
    var startX, startY, endX, endY;
    for (var idx = 0; idx < forLimit; idx++) {
        var val = (isIterable) ? maybeIterable[idx] : idx;

        var midEdgeIdx = ((val + 1) * ((numMidEdges) * 4) -4);
        startX = midSpringsPos[midEdgeIdx + 0];
        startY = midSpringsPos[midEdgeIdx + 1];
        endX   = midSpringsPos[midEdgeIdx + 2];
        endY   = midSpringsPos[midEdgeIdx + 3];

        arrowStartPos[6*idx + 0] = startX;
        arrowStartPos[6*idx + 1] = startY;
        arrowStartPos[6*idx + 2] = startX;
        arrowStartPos[6*idx + 3] = startY;
        arrowStartPos[6*idx + 4] = startX;
        arrowStartPos[6*idx + 5] = startY;

        arrowEndPos[6*idx + 0] = endX;
        arrowEndPos[6*idx + 1] = endY;
        arrowEndPos[6*idx + 2] = endX;
        arrowEndPos[6*idx + 3] = endY;
        arrowEndPos[6*idx + 4] = endX;
        arrowEndPos[6*idx + 5] = endY;

        arrowNormalDir[3*idx + 0] = 0;  // Tip vertex
        arrowNormalDir[3*idx + 1] = 1;  // Left vertex
        arrowNormalDir[3*idx + 2] = -1; // Right vertex

        var pointSize = pointSizes[logicalEdges[2*val+ 1]];
        arrowPointSizes[3*idx + 0] = pointSize;
        arrowPointSizes[3*idx + 1] = pointSize;
        arrowPointSizes[3*idx + 2] = pointSize;

        arrowColors[3*idx + 0] = edgeColors32[2*val + 1];
        arrowColors[3*idx + 1] = edgeColors32[2*val + 1];
        arrowColors[3*idx + 2] = edgeColors32[2*val + 1];

    }
};

RenderingScheduler.prototype.getMidEdgeColors = function (bufferSnapshot, numEdges, numRenderedSplits) {
    var midEdgeColors, edges, edgeColors, srcColorInt, srcColor,
        dstColorInt, dstColor, edgeIndex, midEdgeIndex, numSegments, lambda,
        colorHSVInterpolator, convertRGBInt2Color, convertColor2RGBInt, interpolatedColorInt;

    var numMidEdgeColors = numEdges * (numRenderedSplits + 1);

    var interpolatedColor = {};
    srcColor = {};
    dstColor = {};

    midEdgeColors = this.getTypedArray('midEdgesColors', Uint32Array, numMidEdgeColors);

    numSegments = numRenderedSplits + 1;
    edges = new Uint32Array(bufferSnapshot.logicalEdges.buffer);
    edgeColors = new Uint32Array(bufferSnapshot.edgeColors.buffer);

    var cache = [];
    var putInCache = function (src, dst, val) {
        cache[src] = cache[src] || [];
        cache[src][dst] = val;
    };
    var getFromCache = function (src, dst) {
        if (!cache[src]) {
            return undefined;
        }
        return cache[src][dst];
    };


    // Interpolate colors in the HSV color space.
    colorHSVInterpolator = function (color1, color2, lambda) {
        var color1HSV, color2HSV, h, s, v;
        color1HSV = color1.hsv();
        color2HSV = color2.hsv();
        var h1 = color1HSV.h;
        var h2 = color2HSV.h;
        var maxCCW = h1 - h2;
        var maxCW =  (h2 + 360) - h1;
        var hueStep;
        if (maxCW > maxCCW) {
            //hueStep = higherHue - lowerHue;
            //hueStep = h2 - h1;
            hueStep = h2 - h1;
        } else {
            //hueStep = higherHue - lowerHue;
            hueStep = (360 + h2) - h1;
        }
        h = (h1 + (hueStep * (lambda))) % 360;
        //h = color1HSV.h * (1 - lambda) + color2HSV.h * (lambda);
        s = color1HSV.s * (1 - lambda) + color2HSV.s * (lambda);
        v = color1HSV.v * (1 - lambda) + color2HSV.v * (lambda);
        return interpolatedColor.hsv([h, s, v]);
    };

    var colorRGBInterpolator = function (color1, color2, lambda) {
        var r, g, b;
        r = color1.r * (1 - lambda) + color2.r * (lambda);
        g = color1.g * (1 - lambda) + color2.g * (lambda);
        b = color1.b * (1 - lambda) + color2.b * (lambda);
        return {
            r: r,
            g: g,
            b: b
        };
    };

    // Convert from HSV to RGB Int
    convertColor2RGBInt = function (color) {
        return (color.r << 0) + (color.g << 8) + (color.b << 16);
    };

    // Convert from RGB Int to HSV
    convertRGBInt2Color= function (rgbInt) {
        return {
            r:rgbInt & 0xFF,
            g:(rgbInt >> 8) & 0xFF,
            b:(rgbInt >> 16) & 0xFF
        };
    };


    for (edgeIndex = 0; edgeIndex < numEdges/2; edgeIndex++) {

        srcColorInt = edgeColors[edgeIndex*2];
        dstColorInt = edgeColors[edgeIndex*2 + 1];

        var midEdgeColorIndex = (2*edgeIndex) * numSegments;
        var colorArray = getFromCache(srcColorInt, dstColorInt);
        if (!colorArray) {
            colorArray = new Uint32Array(numSegments*2);
            srcColor = convertRGBInt2Color(srcColorInt);
            dstColor = convertRGBInt2Color(dstColorInt);

            interpolatedColorInt = convertColor2RGBInt(srcColor);
            colorArray[0] = interpolatedColorInt;

            for (midEdgeIndex = 0; midEdgeIndex < numSegments; midEdgeIndex++) {
                colorArray[midEdgeIndex*2] = interpolatedColorInt;
                lambda = (midEdgeIndex + 1) / (numSegments);
                interpolatedColorInt =
                    convertColor2RGBInt(colorRGBInterpolator(srcColor, dstColor, lambda));

                colorArray[midEdgeIndex*2 + 1] = interpolatedColorInt;
            }
            putInCache(srcColorInt, dstColorInt, colorArray);
        }

        midEdgeColors.set(colorArray, midEdgeColorIndex);
    }

    return midEdgeColors;
};

RenderingScheduler.prototype.makeArrows = function (bufferSnapshots, edgeMode, numRenderedSplits) {
    var logicalEdges = new Uint32Array(bufferSnapshots.logicalEdges.buffer);
    var pointSizes = new Uint8Array(bufferSnapshots.pointSizes.buffer);
    var edgeColors = new Uint32Array(bufferSnapshots.edgeColors.buffer);
    var numEdges = logicalEdges.length / 2;






    if (!bufferSnapshots.arrowStartPos) {
        // bufferSnapshots.arrowStartPos = new Float32Array(numEdges * 2 * 3);
        bufferSnapshots.arrowStartPos = this.getTypedArray('arrowStartPos', Float32Array, numEdges * 2 * 3);
    }
    var arrowStartPos = bufferSnapshots.arrowStartPos;

    if (!bufferSnapshots.arrowEndPos) {
        // bufferSnapshots.arrowEndPos = new Float32Array(numEdges * 2 * 3);
        bufferSnapshots.arrowEndPos = this.getTypedArray('arrowEndPos', Float32Array, numEdges * 2 * 3);
    }
    var arrowEndPos = bufferSnapshots.arrowEndPos;

    if (!bufferSnapshots.arrowNormalDir) {
        // bufferSnapshots.arrowNormalDir = new Float32Array(numEdges * 3);
        bufferSnapshots.arrowNormalDir = this.getTypedArray('arrowNormalDir', Float32Array, numEdges * 3);
    }
    var arrowNormalDir = bufferSnapshots.arrowNormalDir;

    if (!bufferSnapshots.arrowColors) {
        // bufferSnapshots.arrowColors = new Uint32Array(numEdges * 3);
        bufferSnapshots.arrowColors = this.getTypedArray('arrowColors', Uint32Array, numEdges * 3);
    }
    var arrowColors = bufferSnapshots.arrowColors;

    if (!bufferSnapshots.arrowPointSizes) {
        // bufferSnapshots.arrowPointSizes = new Uint8Array(numEdges * 3);
        bufferSnapshots.arrowPointSizes = this.getTypedArray('arrowPointSizes', Uint8Array, numEdges * 3);
    }
    var arrowPointSizes = bufferSnapshots.arrowPointSizes;

    this.populateArrowBuffers(numEdges, bufferSnapshots.midSpringsPos, arrowStartPos,
            arrowEndPos, arrowNormalDir, pointSizes, logicalEdges,
            arrowPointSizes, arrowColors, edgeColors, numRenderedSplits);
};

/*
 * Render expensive items (eg, edges) when a quiet state is detected. This function is called
 * from within an animation frame and must execute all its work inside it. Callbacks(rx, etc)
 * are not allowed as they would schedule work outside the animation frame.
 */
RenderingScheduler.prototype.renderSlowEffects = function () {
    var that = this;
    var appSnapshot = that.appSnapshot;
    var renderState = that.renderState;
    var edgeMode = renderState.get('config').get('edgeMode');
    var edgeHeight = renderState.get('config').get('arcHeight');
    var clientMidEdgeInterpolation = renderState.get('config').get('clientMidEdgeInterpolation');
    var numRenderedSplits = renderState.get('config').get('numRenderedSplits');
    var midSpringsPos;
    var midEdgesColors;
    var start;
    var end1, end2, end3, end4;

    var expanded;

    if ( clientMidEdgeInterpolation && appSnapshot.vboUpdated) {
        //ARCS
        start = Date.now();

        expanded = that.expandLogicalEdges(renderState, appSnapshot.buffers, numRenderedSplits, edgeHeight);
        midSpringsPos = expanded.midSpringsPos;
        appSnapshot.buffers.midSpringsPos = midSpringsPos;
        appSnapshot.buffers.midSpringsStarts = expanded.midSpringsStarts;
        appSnapshot.buffers.midSpringsEnds = expanded.midSpringsEnds;

        // Only setup midEdge colors once, or when filtered.
        // Approximates filtering when number of logicalEdges changes.
        var numEdges = midSpringsPos.length / 2 / (numRenderedSplits + 1);
        var expectedNumMidEdgeColors = numEdges * (numRenderedSplits + 1);

        var shouldRecomputeEdgeColors =
            (!appSnapshot.buffers.midEdgesColors ||
            (appSnapshot.buffers.midEdgesColors.length !== expectedNumMidEdgeColors) ||
            appSnapshot.bufferReceivedVersions.edgeColors !== appSnapshot.bufferComputedVersions.edgeColors);

        if (shouldRecomputeEdgeColors) {
            midEdgesColors = that.getMidEdgeColors(appSnapshot.buffers, numEdges, numRenderedSplits);
        }
        end1 = Date.now();
        if (shouldRecomputeEdgeColors) {
            appSnapshot.buffers.midEdgesColors = midEdgesColors;
            renderer.loadBuffers(renderState, {'midEdgesColors': midEdgesColors});
            appSnapshot.bufferComputedVersions.edgeColors = appSnapshot.bufferReceivedVersions.edgeColors;
        }

        renderer.loadBuffers(renderState, {'midSpringsPos': midSpringsPos});
        renderer.loadBuffers(renderState, {'midSpringsStarts': expanded.midSpringsStarts});
        renderer.loadBuffers(renderState, {'midSpringsEnds': expanded.midSpringsEnds});
        renderer.setNumElements(renderState, 'edgepicking', midSpringsPos.length / 2);
        renderer.setNumElements(renderState, 'midedgeculled', midSpringsPos.length / 2);
        end2 = Date.now();
        debug('Edges expanded in', end1 - start, '[ms], and loaded in', end2 - end1, '[ms]');
        that.makeArrows(appSnapshot.buffers, edgeMode, numRenderedSplits);
        end3 = Date.now();
        renderer.loadBuffers(renderState, {'arrowStartPos': appSnapshot.buffers.arrowStartPos});
        renderer.loadBuffers(renderState, {'arrowEndPos': appSnapshot.buffers.arrowEndPos});
        renderer.loadBuffers(renderState, {'arrowNormalDir': appSnapshot.buffers.arrowNormalDir});
        renderer.loadBuffers(renderState, {'arrowColors': appSnapshot.buffers.arrowColors});
        renderer.loadBuffers(renderState, {'arrowPointSizes': appSnapshot.buffers.arrowPointSizes});

        // numEdges = length / 4 (stored as UInt8) * 0.5 (biDirectional)
        // numArrowElements = 3 * numEdges.
        var numArrowCulled = ((appSnapshot.buffers.logicalEdges.length / 2) / 4) * 3;

        renderer.setNumElements(renderState, 'arrowculled', numArrowCulled);
        end4 = Date.now();

        debug('Arrows generated in ', end3 - end2, '[ms], and loaded in', end4 - end3, '[ms]');

    } else if (appSnapshot.vboUpdated) {
        //EDGE BUNDLING
        //TODO deprecate/integrate?
        start = Date.now();

        expanded = that.expandLogicalMidEdges(appSnapshot.buffers);
        midSpringsPos = expanded.midSpringsPos;

        renderer.loadBuffers(renderState, {'midSpringsPos': midSpringsPos});
        renderer.loadBuffers(renderState, {'midSpringsStarts': expanded.midSpringsStarts});
        renderer.loadBuffers(renderState, {'midSpringsEnds': expanded.midSpringsEnds});
        end1 = Date.now();
        renderer.setNumElements(renderState, 'edgepicking', midSpringsPos.length / 2);
        end2 = Date.now();
        console.debug('Edges expanded in', end1 - start, '[ms], and loaded in', end2 - end1, '[ms]');
    }


    renderer.setCamera(renderState);
    renderer.render(renderState, 'fullscene', 'renderSceneFull');
    renderer.render(renderState, 'picking', 'picking', undefined, undefined, function () {
        that.appSnapshot.hitmapUpdates.onNext();
    });

    // TODO: Make steadyStateTextureDark instead of just doing it in the shader.
    renderer.copyCanvasToTexture(renderState, 'steadyStateTexture');
    renderer.setupFullscreenBuffer(renderState);
    that.renderMouseoverEffects();

    that.appSnapshot.fullScreenBufferDirty = false;
};

function getSortedConnectedEdges (nodeId, forwardsEdgeStartEndIdxs) {
    var resultSet = [];

    var stride = 2 * nodeId;
    var start = forwardsEdgeStartEndIdxs[stride];
    var end = forwardsEdgeStartEndIdxs[stride + 1];
    while (start < end) {
        var edgeIdx = start;
        resultSet.push(edgeIdx);
        start++;
    }

    return resultSet;
}

/*
 * Render mouseover effects. These should only occur during a quiet state.
 *
 */

RenderingScheduler.prototype.renderMouseoverEffects = function (task) {
    var that = this;
    var appSnapshot = that.appSnapshot;
    var renderState = that.renderState;
    var buffers = appSnapshot.buffers;
    var numRenderedSplits = renderState.get('config').get('numRenderedSplits');

    // HACK for GIS
    if (!numRenderedSplits && numRenderedSplits !== 0) {
        if (buffers.midSpringsPos) {
            numRenderedSplits = Math.round(((buffers.midSpringsPos.length / 4) / (buffers.logicalEdges.length / 8)) - 1);
        } else {
            return;
        }
    }
    var numMidEdges = numRenderedSplits + 1;

    // We haven't received any VBOs yet, so we shouldn't attempt to render.
    if (!buffers.logicalEdges) {
        return;
    }

    task = task || that.lastMouseoverTask;
    if (!task) {
        return;
    }

    // Cache a copy of the task in case we need to execute again with our last task.
    // TODO: Consider restructuring it so that this isn't a stateful function.
    //
    // We need to be careful not to accidentally modify the internals of this cached task.
    // To be safe, we always cache it as a separate copy. Sucks because we need to know its full structure
    // here too, but whatever.
    that.lastMouseoverTask = {
        trigger: 'mouseOverEdgeHighlight',
        data: {
            highlight: {
                nodeIndices: _.clone(task.data.highlight.nodeIndices),
                edgeIndices: _.clone(task.data.highlight.edgeIndices)
            },
            selected: {
                nodeIndices: _.clone(task.data.selected.nodeIndices),
                edgeIndices: _.clone(task.data.selected.edgeIndices)
            }
        }
    };


    var logicalEdges = new Uint32Array(buffers.logicalEdges.buffer);
    var hostBuffers = renderState.get('hostBuffersCache');
    var forwardsEdgeStartEndIdxs = new Uint32Array(hostBuffers.forwardsEdgeStartEndIdxs.buffer);

    var forwardsEdgeToUnsortedEdge = new Uint32Array(hostBuffers.forwardsEdgeToUnsortedEdge.buffer);

    var hostNodePositions = new Float32Array(hostBuffers.curPoints.buffer);
    var hostNodeSizes = hostBuffers.pointSizes;
    var hostNodeColors = new Uint32Array(hostBuffers.pointColors.buffer);

    //////////////////////////////////////////////////////////////////////////
    // Expand highlighted neighborhoods
    //////////////////////////////////////////////////////////////////////////

    var highlightedEdgeIndices = task.data.highlight.edgeIndices || [];
    var highlightedNodeIndices = task.data.highlight.nodeIndices || [];

    var selectedEdgeIndices = task.data.selected.edgeIndices || [];
    var selectedNodeIndices = task.data.selected.nodeIndices || [];

    var initialHighlightLengths = highlightedEdgeIndices.length + highlightedNodeIndices.length;
    var initialSelectedLengths = selectedEdgeIndices.length + selectedNodeIndices.length;

    // TODO: Decide whether we need to de-duplicate these arrays.
    // TODO: Decide a threshold or such to show neighborhoods for large selections.
    if (initialHighlightLengths <= 1) {
        // Extend edges with neighbors of nodes
        // BAD because uses pushes.

        _.each(highlightedNodeIndices, function (val) {
            var sortedConnectedEdges = getSortedConnectedEdges(val, forwardsEdgeStartEndIdxs);
            _.each(sortedConnectedEdges, (sortedEdge) => {
                var unsortedEdge = forwardsEdgeToUnsortedEdge[sortedEdge];
                highlightedEdgeIndices.push(unsortedEdge);
            });

        });

        // Extend node indices with edge endpoints
        _.each(highlightedEdgeIndices, function (val) {
            var stride = 2 * val;
            highlightedNodeIndices.push(logicalEdges[stride]);
            highlightedNodeIndices.push(logicalEdges[stride + 1]);
        });
    }


    //////////////////////////////////////////////////////////////////////////
    // Setup highlight buffers
    //////////////////////////////////////////////////////////////////////////

    renderer.setNumElements(renderState, 'edgehighlight', highlightedEdgeIndices.length * 2 * numMidEdges);
    renderer.setNumElements(renderState, 'pointhighlight', highlightedNodeIndices.length);
    renderer.setNumElements(renderState, 'arrowhighlight', highlightedEdgeIndices.length * 3);

    if (initialHighlightLengths > 0) {
        // TODO: Start with a small buffer and increase if necessary, masking underlying
        // data so we don't have to clear out later values. This way we won't have to constantly allocate
        buffers.highlightedEdges = new Float32Array(highlightedEdgeIndices.length * 4 * numMidEdges);
        buffers.highlightedNodePositions = new Float32Array(highlightedNodeIndices.length * 2);
        buffers.highlightedNodeSizes = new Uint8Array(highlightedNodeIndices.length);
        buffers.highlightedNodeColors = new Uint32Array(highlightedNodeIndices.length);
        buffers.highlightedArrowStartPos = new Float32Array(highlightedEdgeIndices.length * 2 * 3);
        buffers.highlightedArrowEndPos = new Float32Array(highlightedEdgeIndices.length * 2 * 3);
        buffers.highlightedArrowNormalDir = new Float32Array(highlightedEdgeIndices.length * 3);
        buffers.highlightedArrowPointColors = new Uint32Array(highlightedEdgeIndices.length * 3);
        buffers.highlightedArrowPointSizes = new Uint8Array(highlightedEdgeIndices.length * 3);

        // Copy in data
        _.each(highlightedEdgeIndices, function (val, idx) {
            // The start at the first midedge corresponding to hovered edge
            var edgeStartIdx = (val * 4 * numMidEdges);
            var highlightStartIdx = (idx * 4 * numMidEdges);
            for (var midEdgeIdx = 0; midEdgeIdx < numMidEdges; midEdgeIdx = midEdgeIdx + 1) {
                var midEdgeStride = midEdgeIdx * 4;
                buffers.highlightedEdges[highlightStartIdx + midEdgeStride] = buffers.midSpringsPos[edgeStartIdx + (midEdgeStride)];
                buffers.highlightedEdges[highlightStartIdx + midEdgeStride + 1] = buffers.midSpringsPos[edgeStartIdx + (midEdgeStride) + 1];
                buffers.highlightedEdges[highlightStartIdx + midEdgeStride + 2] = buffers.midSpringsPos[edgeStartIdx + (midEdgeStride) + 2];
                buffers.highlightedEdges[highlightStartIdx + midEdgeStride + 3] = buffers.midSpringsPos[edgeStartIdx + (midEdgeStride) + 3];
            }
        });

        _.each(highlightedNodeIndices, function (val, idx) {
            buffers.highlightedNodePositions[idx*2] = hostNodePositions[val*2];
            buffers.highlightedNodePositions[idx*2 + 1] = hostNodePositions[val*2 + 1];
            buffers.highlightedNodeSizes[idx] = hostNodeSizes[val];
            buffers.highlightedNodeColors[idx] = hostNodeColors[val];
        });

        that.populateArrowBuffers(highlightedEdgeIndices, buffers.midSpringsPos, buffers.highlightedArrowStartPos,
                buffers.highlightedArrowEndPos, buffers.highlightedArrowNormalDir, hostNodeSizes,
                logicalEdges, buffers.highlightedArrowPointSizes, buffers.highlightedArrowPointColors,
                buffers.edgeColors, numRenderedSplits);

        renderer.loadBuffers(renderState, {
            'highlightedEdgesPos': buffers.highlightedEdges,
            'highlightedPointsPos': buffers.highlightedNodePositions,
            'highlightedPointsSizes': buffers.highlightedNodeSizes,
            'highlightedPointsColors': buffers.highlightedNodeColors,
            'highlightedArrowStartPos': buffers.highlightedArrowStartPos,
            'highlightedArrowEndPos': buffers.highlightedArrowEndPos,
            'highlightedArrowNormalDir': buffers.highlightedArrowNormalDir,
            'highlightedArrowPointColors': buffers.highlightedArrowPointColors,
            'highlightedArrowPointSizes': buffers.highlightedArrowPointSizes
        });
    }

    //////////////////////////////////////////////////////////////////////////
    // Setup selected buffers
    //////////////////////////////////////////////////////////////////////////

    // TODO: Start with a small buffer and increase if necessary, masking underlying
    // data so we don't have to clear out later values. This way we won't have to constantly allocate

    renderer.setNumElements(renderState, 'edgeselected', selectedEdgeIndices.length * 2 * numMidEdges);
    renderer.setNumElements(renderState, 'pointselected', selectedNodeIndices.length);
    renderer.setNumElements(renderState, 'arrowselected', selectedEdgeIndices.length * 3);

    if (initialSelectedLengths > 0) {

        buffers.selectedEdges = new Float32Array(selectedEdgeIndices.length * 4 * numMidEdges);
        buffers.selectedEdgeStarts = new Float32Array(selectedEdgeIndices.length * 4 * numMidEdges);
        buffers.selectedEdgeEnds = new Float32Array(selectedEdgeIndices.length * 4 * numMidEdges);
        buffers.selectedEdgeColors = new Uint32Array(selectedEdgeIndices.length * 2 * numMidEdges);
        buffers.selectedNodePositions = new Float32Array(selectedNodeIndices.length * 2);
        buffers.selectedNodeSizes = new Uint8Array(selectedNodeIndices.length);
        buffers.selectedNodeColors = new Uint32Array(selectedNodeIndices.length);
        buffers.selectedArrowStartPos = new Float32Array(selectedEdgeIndices.length * 2 * 3);
        buffers.selectedArrowEndPos = new Float32Array(selectedEdgeIndices.length * 2 * 3);
        buffers.selectedArrowNormalDir = new Float32Array(selectedEdgeIndices.length * 3);
        buffers.selectedArrowPointColors = new Uint32Array(selectedEdgeIndices.length * 3);
        buffers.selectedArrowPointSizes = new Uint8Array(selectedEdgeIndices.length * 3);

        // Copy in data
        _.each(selectedEdgeIndices, function (val, idx) {
            // The start at the first midedge corresponding to hovered edge
            var edgeStartIdx = (val * 4 * numMidEdges);
            var highlightStartIdx = (idx * 4 * numMidEdges);
            var edgeColorStartIdx = (val * 2 * numMidEdges);
            var highlightColorStartIdx = (idx * 2 * numMidEdges);
            for (var midEdgeIdx = 0; midEdgeIdx < numMidEdges; midEdgeIdx ++) {
                var midEdgeStride = midEdgeIdx * 4;
                buffers.selectedEdges[highlightStartIdx + midEdgeStride] = buffers.midSpringsPos[edgeStartIdx + (midEdgeStride)];
                buffers.selectedEdges[highlightStartIdx + midEdgeStride + 1] = buffers.midSpringsPos[edgeStartIdx + (midEdgeStride) + 1];
                buffers.selectedEdges[highlightStartIdx + midEdgeStride + 2] = buffers.midSpringsPos[edgeStartIdx + (midEdgeStride) + 2];
                buffers.selectedEdges[highlightStartIdx + midEdgeStride + 3] = buffers.midSpringsPos[edgeStartIdx + (midEdgeStride) + 3];

                buffers.selectedEdgeStarts[highlightStartIdx + midEdgeStride] = buffers.midSpringsStarts[edgeStartIdx + (midEdgeStride)];
                buffers.selectedEdgeStarts[highlightStartIdx + midEdgeStride + 1] = buffers.midSpringsStarts[edgeStartIdx + (midEdgeStride) + 1];
                buffers.selectedEdgeStarts[highlightStartIdx + midEdgeStride + 2] = buffers.midSpringsStarts[edgeStartIdx + (midEdgeStride) + 2];
                buffers.selectedEdgeStarts[highlightStartIdx + midEdgeStride + 3] = buffers.midSpringsStarts[edgeStartIdx + (midEdgeStride) + 3];

                buffers.selectedEdgeEnds[highlightStartIdx + midEdgeStride] = buffers.midSpringsEnds[edgeStartIdx + (midEdgeStride)];
                buffers.selectedEdgeEnds[highlightStartIdx + midEdgeStride + 1] = buffers.midSpringsEnds[edgeStartIdx + (midEdgeStride) + 1];
                buffers.selectedEdgeEnds[highlightStartIdx + midEdgeStride + 2] = buffers.midSpringsEnds[edgeStartIdx + (midEdgeStride) + 2];
                buffers.selectedEdgeEnds[highlightStartIdx + midEdgeStride + 3] = buffers.midSpringsEnds[edgeStartIdx + (midEdgeStride) + 3];

                var midEdgeColorStride = midEdgeIdx * 2;
                buffers.selectedEdgeColors[highlightColorStartIdx + midEdgeColorStride] = buffers.midEdgesColors[edgeColorStartIdx + midEdgeColorStride];
                buffers.selectedEdgeColors[highlightColorStartIdx + midEdgeColorStride + 1] = buffers.midEdgesColors[edgeColorStartIdx + midEdgeColorStride + 1];
            }
        });

        _.each(selectedNodeIndices, function (val, idx) {
            buffers.selectedNodePositions[idx*2] = hostNodePositions[val*2];
            buffers.selectedNodePositions[idx*2 + 1] = hostNodePositions[val*2 + 1];
            buffers.selectedNodeSizes[idx] = hostNodeSizes[val];
            buffers.selectedNodeColors[idx] = hostNodeColors[val];
        });

        that.populateArrowBuffers(selectedEdgeIndices, buffers.midSpringsPos, buffers.selectedArrowStartPos,
                buffers.selectedArrowEndPos, buffers.selectedArrowNormalDir, hostNodeSizes,
                logicalEdges, buffers.selectedArrowPointSizes, buffers.selectedArrowPointColors,
                buffers.edgeColors, numRenderedSplits);

        renderer.loadBuffers(renderState, {
            'selectedMidSpringsPos': buffers.selectedEdges,
            'selectedMidEdgesColors': buffers.selectedEdgeColors,
            'selectedMidSpringsStarts': buffers.selectedEdgeStarts,
            'selectedMidSpringsEnds': buffers.selectedEdgeEnds,
            'selectedCurPoints': buffers.selectedNodePositions,
            'selectedPointSizes': buffers.selectedNodeSizes,
            'selectedPointColors': buffers.selectedNodeColors,
            'selectedArrowStartPos': buffers.selectedArrowStartPos,
            'selectedArrowEndPos': buffers.selectedArrowEndPos,
            'selectedArrowNormalDir': buffers.selectedArrowNormalDir,
            'selectedArrowColors': buffers.selectedArrowPointColors,
            'selectedArrowPointSizes': buffers.selectedArrowPointSizes
        });

    }

    //////////////////////////////////////////////////////////////////////////
    // Handle Rendering + Texture backdrop.
    //////////////////////////////////////////////////////////////////////////

    var shouldDarken = selectedEdgeIndices.length > 0 || selectedNodeIndices.length > 0;
    var renderTrigger = shouldDarken ? 'highlightDark' : 'highlight';

    renderer.setCamera(renderState);
    renderer.render(renderState, renderTrigger, renderTrigger);
};


// Given a render config and info about number of nodes/edges,
// generate an array of functions that will allocate memory for them
RenderingScheduler.prototype.allocateAllArrayBuffersFactory = function (config, numElements, renderState) {
    var that = this;
    var functions = [];
    debug('Allocating all arraybuffers on hint for numElements: ', numElements);
    _.each(config.models, function (model, modelName) {
        _.each(model, function (desc) {
            if (desc.sizeHint) {
                // Default to 4;
                // TODO: Have a proper lookup for bytelengths
                var bytesPerElement = 4;
                if (desc.type === 'FLOAT') {
                    bytesPerElement = 4;
                } else if (desc.type === 'UNSIGNED_INT') {
                    bytesPerElement = 4;
                }  else if (desc.type === 'UNSIGNED_BYTE') {
                    bytesPerElement = 1;
                }

                // HACK
                // TODO: Replace this eval with a safer way (function lookup in common?)
                // It evals a size hint from render config into a number.
                // We do this because we can't send these functions over the network with
                // the rest of render config.
                var sizeInBytes = eval(desc.sizeHint) * desc.count * bytesPerElement; // jshint ignore:line

                // Allocate arraybuffers for RenderingScheduler
                functions.push(function () {
                    that.allocateArrayBufferOnHint(modelName, sizeInBytes);
                });
                // Allocate GPU buffer in renderer
                functions.push(function () {
                    renderer.allocateBufferSize(renderState, modelName, sizeInBytes);
                });
            }
        });
    });
    return functions;
};

// Explicitly allocate an array buffer for a given name based on a size hint
RenderingScheduler.prototype.allocateArrayBufferOnHint = function (name, bytes) {
    debug('Hinted allocation of', bytes, 'bytes for', name);
    if (!this.arrayBuffers[name] || this.arrayBuffers[name].byteLength < bytes) {
        debug('Allocating', bytes, 'bytes for', name, 'on hint.');
        this.arrayBuffers[name] = new ArrayBuffer(bytes);
    }
};

// Get a typed array by name, of a certain type and length.
// We go through this function to allow arraybuffer reuse,
// and to make preallocation easier. Because we reuse data buffers,
// older typed arrays of the same name are invalidated.
RenderingScheduler.prototype.getTypedArray = function (name, Constructor, length) {
    var bytesPerElement = Constructor.BYTES_PER_ELEMENT;
    var lengthInBytes = length * bytesPerElement;
    debug('getting typed array for ' + name + ':', Constructor, length, lengthInBytes);
    // TODO: Check to make sure that we don't leak references to old
    // array buffers when we replace with a bigger one.
    if (!this.arrayBuffers[name] || this.arrayBuffers[name].byteLength < lengthInBytes) {
        debug('Reallocating for ' + name + ' to: ', lengthInBytes, 'bytes');
        debug('Old byteLength: ', this.arrayBuffers[name] ? this.arrayBuffers[name].byteLength : 0);
        this.arrayBuffers[name] = new ArrayBuffer(lengthInBytes);
    } else {
        debug('Was in cache of proper size -- fast path');
    }

    var array = new Constructor(this.arrayBuffers[name], 0, length);
    return array;
};

// Given a render config and info about number of nodes/edges,
// figure out the size of our largest model for letting the
// renderer create index buffers.
RenderingScheduler.prototype.getLargestModelSize = function (config, numElements) {
    debug('Getting largerst model size for: ', numElements);
    var sizes = _.map(config.models, function (model) {
        return _.map(model, function (desc) {
            if (desc.sizeHint) {
                // HACK
                // TODO: Replace this eval with a safer way (function lookup in common?)
                // It evals a size hint from render config into a number.
                // We do this because we can't send these functions over the network with
                // the rest of render config.
                var num = eval(desc.sizeHint); // jshint ignore:line
                return num;
            } else {
                return 0;
            }
        });
    });
    var maxNum = _.max(_.flatten(sizes));
    return maxNum;
};

module.exports = {
    setupBackgroundColor: setupBackgroundColor,
    setupCameraInteractions: setupCameraInteractions,
    setupCameraInteractionRenderUpdates: setupCameraInteractionRenderUpdates,
    RenderingScheduler: RenderingScheduler,
    getEdgeLabelPos: getEdgeLabelPos
};
