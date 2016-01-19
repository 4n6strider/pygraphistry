'use strict';


var $$       = window.Quo;
var $        = window.$;
var Rx       = require('rxjs/Rx.KitchenSink');
               require('../rx-jquery-stub');
var _        = require('underscore');
var debug    = require('debug')('graphistry:StreamGL:interaction');
var util     = require('./util.js');


///////////////////////////////////////////////////////////////////////////////
// Mouse event handlers
///////////////////////////////////////////////////////////////////////////////


/**
 * Adds event listeners for drag events and changes the local camera position in response.
 *
 * @param  {jQuery object} $eventTarget - The jQuery object which wraps the DOM element to detect
 *                                        drag events on.
 * @param  {Camera} camera              - The camera object to update based off of drag events.
 *
 * @return {Rx.Observable} Rx stream with Camera objects for every drag event.
 */
function setupDrag($eventTarget, camera, appState) {
    var $sim = $('#simulation');
    var $html = $('html');

    return $eventTarget.mousedownAsObservable()
        .switchMap(util.observableFilter(appState.anyMarqueeOn, util.notIdentity))
        .filter(function (evt) {
            var $p = $(evt.target);

            //allow dragging by graph label title
            for (var i = 0; i < 2; i++) {
                if ($p.hasClass('graph-label')) {
                    return true;
                }
                $p = $p.parent();
            }

            for (var j = 0; j < 8; j++) {
                //allow dragging if not clicked
                if ($p.hasClass('graph-label')) {
                    return !$p.hasClass('clicked');
                }
                $p = $p.parent();
            }
            return true;
        })
        .do(function (clickPos) {
            clickPos.preventDefault();
            $sim.toggleClass('moving', true);
        })
        .switchMap(function(clickPos) {
            return $('html').mousemoveAsObservable()
                .takeUntil($html.mouseupAsObservable()
                    .do(function () {
                        $sim.toggleClass('moving', false);
                    }))
                .distinctUntilChanged(function(a, b) {
                    return (a.x === b.x) && (a.y === b.y);
                }, function(pos) { return {x: pos.pageX, y: pos.pageY}; })
                .scan(function(accPos, curPos) {
                    // Calculate the distance moved (since last event) for each move event

                    // Use raw dom element to get height/width for perf reasons.
                    var rawTarget = $eventTarget[0];

                    return {
                        deltaX: (curPos.pageX - accPos.x) / rawTarget.offsetWidth,
                        deltaY: (curPos.pageY - accPos.y) / rawTarget.offsetHeight,
                        x: curPos.pageX,
                        y: curPos.pageY
                    };
                }, {x: clickPos.pageX, y: clickPos.pageY, deltaX: 0, deltaY: 0})
                .filter(function (dragEvent) {
                    return dragEvent.deltaX !== 0 || dragEvent.deltaY !== 0;
                })
                .map(function(dragEvent) {
                    camera.center.x -= dragEvent.deltaX * camera.width ;
                    camera.center.y -= dragEvent.deltaY * camera.height;
                    return camera;
                });
        });
}


function setupMousemove($eventTarget) {
    debug('setupMouseover');
    var bounds = $('canvas', $eventTarget[0])[0].getBoundingClientRect();

    var initial = {x: 0, y: 0};

    return $eventTarget.mousemoveAsObservable()
        .filter(function (v) {
            return ! $(v.target).parents('.graph-label.clicked').length;
        })
        .inspectTime(1)
        .map(function (evt) {
            evt.preventDefault();
            return {
                x: evt.clientX - bounds.left,
                y: evt.clientY - bounds.top
            };
        })
        .merge(Rx.Observable.return(initial));
}


/*
    shift left/right: rotate
    shift up/down: tilt
*/
// Camera -> Observable Camera
// feature-gated by 3d
function setupRotate(camera) {

    var presses = new Rx.Subject();

    $(document).keydown(function (e) { presses.onNext(e); });

    var CODES = {LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40};
    var AMT = 5;

    return presses
        .filter(function () { return camera.is3d; })
        .filter(function (e) { return !!e.shiftKey; })
        .do(function (e) {
             switch (e.keyCode || e.which) {
                case CODES.LEFT:
                    camera.rotation.z = (camera.rotation.z + AMT) % 360;
                    break;
                case CODES.UP:
                    camera.rotation.x = (camera.rotation.x + AMT) % 360;
                    break;
                case CODES.RIGHT:
                    camera.rotation.z = (camera.rotation.z - AMT) % 360;
                    break;
                case CODES.DOWN:
                    camera.rotation.x = (camera.rotation.x - AMT) % 360;
                    break;
            }
        })
        .map(_.constant(camera));
}


function setupScroll($eventTarget, canvas, camera, appState) {
    var zoomBase = 1.1;

    return $eventTarget.onAsObservable('mousewheel')
        .inspectTime(1)
        .switchMap(util.observableFilter([appState.marqueeOn, appState.brushOn],
            function (val) {
                return val !== 'done';
            },
            util.AND
        ))
        .filter(function (evt) {
            return ! $(evt.target).parents('.graph-label-contents').length;
        })
        .do(function (wheelEvent) {
            wheelEvent.preventDefault();
        })
        .map(function(wheelEvent) {
            var bounds = $eventTarget[0].getBoundingClientRect();
            var zoomFactor = (wheelEvent.deltaY < 0 ? zoomBase : 1.0 / zoomBase) || 1.0;

            var canvasPos = {
                x: (wheelEvent.clientX - bounds.left),
                y: (wheelEvent.clientY - bounds.top)
            };

            var screenPos = camera.canvas2ScreenCoords(canvasPos.x, canvasPos.y, canvas);
            debug('Mouse screen pos=(%f,%f)', screenPos.x, screenPos.y);

            return zoom(camera, zoomFactor, screenPos);
        });
}

function setupZoomButton($elt, camera, zoomFactor) {
    return Rx.Observable.fromEvent($elt, 'click')
        .map(function () {
            return zoom(camera, zoomFactor);
        });
}

// Camera * Float * {x : Float, y: Float}
// Zoom in/out on zoomPoint (specified in screen coordinates)
function zoom(camera, zoomFactor, zoomPoint) {
    var xoffset = 0;
    var yoffset = 0;
    if (zoomPoint !== undefined) {
        xoffset = zoomPoint.x - camera.center.x;
        yoffset = zoomPoint.y - camera.center.y;
    }

    camera.center.x += xoffset * (1.0 - zoomFactor);
    camera.center.y += yoffset * (1.0 - zoomFactor);
    camera.width = camera.width * zoomFactor;
    camera.height = camera.height * zoomFactor;

    debug('New Camera center=(%f, %f) size=(%f , %f)',
                  camera.center.x, camera.center.y, camera.width, camera.height);

    return camera;
}


function setupCenter($toggle, curPoints, camera) {
    return $toggle.onAsObservable('click')
        .inspectTime(1)
        .switchMap(function () {
            debug('click on center');
            return curPoints.take(1).map(function (curPoints) {
                var points = new Float32Array(curPoints.buffer);

                // Don't attempt to center when nothing is on screen
                if (points.length < 1) {
                    return camera;
                }

                var bbox = {
                    left: Number.MAX_VALUE, right: Number.MIN_VALUE,
                    top: Number.MAX_VALUE, bottom: Number.MIN_VALUE
                };

                for (var i = 0; i < points.length; i+=2) {
                    var x = points[i];
                    var y = points[i+1];
                    bbox.left = x < bbox.left ? x : bbox.left;
                    bbox.right = x > bbox.right ? x : bbox.right;
                    bbox.top = y < bbox.top ? y : bbox.top;
                    bbox.bottom = y > bbox.bottom ? y : bbox.bottom;
                }

                if (points.length === 1) {
                    bbox.left -= 0.1;
                    bbox.right += 0.1;
                    bbox.top -= 0.1;
                    bbox.bottom += 0.1;
                }

                debug('Bounding box: ', bbox);
                camera.centerOn(bbox.left, bbox.right, bbox.bottom * -1, bbox.top * -1);
                return camera;
            });
        });
}

///////////////////////////////////////////////////////////////////////////////
// Touch event handlers
///////////////////////////////////////////////////////////////////////////////


/**
 * Set a variable to detect if the device is touch based.
 */
var iOS = /(iPad|iPhone|iPod)/g.test( navigator.userAgent );
var touchBased = iOS;

/**
 * Helper function to compute distance for pinch-zoom
 */
function straightLineDist(p1, p2) {
    var dx = p1.x - p2.x;
    var dy = p1.y - p2.y;
    return Math.sqrt((dx*dx) + (dy*dy));
}


/**
 * Adds event listeners for swipe (zoom) and changes the local camera position in response.
 *
 * @param  {HTMLElement} eventTarget - The raw DOM element to detect swipe events on.
 * @param  {Camera} camera           - The camera object to update based off of swipe events.
 *
 * @return {Rx.Observable} Rx stream with Camera objects for every swipe event.
 */
function setupSwipe(eventTarget, camera) {
    var $$eventTarget = $$(eventTarget);

    return Rx.Observable.fromEvent($$eventTarget, 'swiping')
        .merge(Rx.Observable.fromEvent($$eventTarget, 'swipe')
            .map( function (ev) {ev.preventDefault(); return 0; }))

        .scan(function (acc, ev) {
            var data = {
                cam: camera,
                oldX: 0.0,
                oldY: 0.0,
                reset: false
            };

            if (ev === 0) {
                data.reset = true;
                return data;
            }

            ev.preventDefault();

            var duringPinch = Array.isArray(ev.originalEvent.currentTouch);
            if (duringPinch) {
                debug('Ignoring swipe event (drag event in progress)');

                if (acc) {
                    data.oldX = acc.oldX;
                    data.oldY = acc.oldY;
                    data.reset = true;
                }
                return data;
            }

            data.oldX = ev.originalEvent.currentTouch.x;
            data.oldY = ev.originalEvent.currentTouch.y;

            if (acc && !acc.reset) {
                var dx = (ev.originalEvent.currentTouch.x - acc.oldX) / $$eventTarget.width();
                var dy = (ev.originalEvent.currentTouch.y - acc.oldY) / $$eventTarget.height();

                camera.center.x -= dx * camera.width;
                camera.center.y -= dy * camera.height;
                data.cam = camera;
            }

            return data;

        }, 0)
        .map(function(data) {
            return data.cam;
        });
}


function setupPinch(eventTarget, camera) {
    var $$eventTarget = $$(eventTarget);

    return Rx.Observable.fromEvent($$eventTarget, 'pinching')
        .merge(Rx.Observable.fromEvent($$eventTarget, 'pinch')
            .map( function (ev) {ev.preventDefault(); return 0; }))

        .scan(function (acc, ev) {
            var data = {
                cam: camera,
                oldDist: -1,
                oldWidth: camera.width,
                oldHeight: camera.height
            };

            if (ev === 0) {
                return data;
            }
            ev.preventDefault();

            var curDist = straightLineDist(ev.originalEvent.currentTouch[0], ev.originalEvent.currentTouch[1]);
            data.oldDist = curDist;

            if (acc && acc.oldDist >= 0) {
                var aspectRatio = acc.oldWidth / acc.oldHeight;
                var scale = acc.oldDist / curDist;

                camera.width = acc.oldWidth * scale;
                camera.height = camera.width / aspectRatio;
                data.cam = camera;
            }
            return data;

        }, 0)
        .map(function(data) {
            return data.cam;
        });
}


module.exports = {
    setupDrag: setupDrag,
    setupMousemove: setupMousemove,
    setupScroll: setupScroll,
    setupCenter: setupCenter,
    setupSwipe: setupSwipe,
    setupPinch: setupPinch,
    setupZoomButton: setupZoomButton,
    setupRotate: setupRotate,

    isTouchBased: touchBased
};
