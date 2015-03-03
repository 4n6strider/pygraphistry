'use strict';

var debug = require('debug')('graphistry:StreamGL:marquee');
var $     = window.$;
var Rx    = require('rx');
            require('./rx-jquery-stub');
var _     = require('underscore');



//$DOM * evt -> {x: num, y: num}
function toPoint ($cont, evt) {
    var offset = $cont.offset();
    return {x: evt.pageX - offset.left, y: evt.pageY - offset.top};
}

//{x: num, y: num} * {x: num, y: num} -> {tl: {x: num, y:num}, br: {x: num, y:num}}
function toRect (pointA, pointB) {
    var left    = Math.min(pointA.x, pointB.x);
    var right   = Math.max(pointA.x, pointB.x);

    var top     = Math.min(pointA.y, pointB.y);
    var bottom  = Math.max(pointA.y, pointB.y);

    var pos = {
        tl: {x: left, y: top},
        br: {x: right, y: bottom}
    };
    return pos;
}

function makeErrorHandler(name) {
    return function (err) {
        console.error(name, err, (err || {}).stack);
    };
}


//$DOM * Observable bool -> ()
//Add/remove 'on'/'off' class
function maintainContainerStyle($cont, isOn) {
     isOn.subscribe(
        function (isOn) {
            debug('marquee toggle', isOn);
            if (isOn) {
                $cont.removeClass('off').addClass('on');
            } else {
                $cont.removeClass('on') .addClass('off');
            }
        },
        makeErrorHandler('$cont on/off'));
}

//$DOM * $DOM * Observable bool -> Observable_1 {top, left, width, height}
//track selections and affect $elt style/class
function marqueeSelections ($cont, $elt, isOn) {
    var bounds = isOn.flatMapLatest(function (isOn) {
            if (!isOn) {
                debug('stop listening for marquee selections');
                return Rx.Observable.empty();
            } else {
                debug('start listening for marquee selections');
                var firstRunSinceMousedown;
                return Rx.Observable.fromEvent($cont, 'mousedown')
                    .do(function (evt) {
                        evt.stopPropagation();
                        $('body').addClass('noselect');
                    }).map(toPoint.bind('', $cont))
                    .do(function () {
                            debug('marquee instance started, listening');
                            firstRunSinceMousedown = true;
                    }).flatMapLatest(function (startPoint) {
                        return Rx.Observable.fromEvent($cont, 'mousemove')
                            .do(function (evt) { evt.stopPropagation(); })
                            .sample(1)
                            .map(function (moveEvt) {
                                return toRect(startPoint, toPoint($cont, moveEvt));
                            }).do(function (rect) {
                                if (firstRunSinceMousedown) {
                                    debug('show marquee instance on first bound calc');
                                    $elt.removeClass('off').addClass('on');
                                    firstRunSinceMousedown = false;
                                }
                                $elt.css({
                                    left: rect.tl.x,
                                    top: rect.tl.y,
                                    width: rect.br.x - rect.tl.x,
                                    height: rect.br.y - rect.tl.y
                                });
                            }).takeUntil(Rx.Observable.fromEvent($cont, 'mouseup')
                                .do(function (evt) {
                                    evt.stopPropagation();
                                    debug('drag marquee finished');
                                    $elt.addClass('draggable');
                                    $('body').removeClass('noselect');
                                    $elt.removeClass('on').addClass('done');
                                })
                            ).takeLast(1);
                    });

            }
        });

    var boundsA = new Rx.ReplaySubject(1);
    bounds.subscribe(boundsA, makeErrorHandler('boundsA'));
    return boundsA;
}

function toDelta(startPoint, endPoint) {
    return {x: endPoint.x - startPoint.x,
            y: endPoint.y - startPoint.y};
}

function marqueeDrags(selections, $cont, $elt) {
    var drags = selections.flatMapLatest(function (selection) {
        var firstRunSinceMousedown = true;
        return Rx.Observable.fromEvent($elt, 'mousedown')
            .do(function (evt) {
                evt.stopPropagation();
                $('body').addClass('noselect');
            })
            .map(toPoint.bind('', $cont))
            .flatMapLatest(function (startPoint) {
                debug('Start of drag: ', startPoint);
                return Rx.Observable.fromEvent($cont, 'mousemove')
                    .do(function (evt) {
                        evt.stopPropagation();
                    })
                    .sample(1)
                    .map(function (evt) {
                        return {start: startPoint, end: toPoint($cont, evt)};
                    }).do(function (drag) {
                        var delta = toDelta(drag.start, drag.end);

                        // Side effects
                        if (firstRunSinceMousedown) {
                            firstRunSinceMousedown = false;
                            $elt.removeClass('draggable').addClass('dragging');
                        }
                        $elt.css({
                            left: selection.tl.x + delta.x,
                            top: selection.tl.y + delta.y
                        });
                    }).takeUntil(Rx.Observable.fromEvent($elt, 'mouseup')
                        .do(function () {
                            debug('End of drag');
                            $elt.removeClass('dragging').removeClass('done').addClass('off');
                            $('body').removeClass('noselect');
                        })
                    ).takeLast(1);
            });
    });

    var dragsA = new Rx.ReplaySubject(1);
    drags.subscribe(dragsA, makeErrorHandler('dragsA'));
    return dragsA;
}

function createElt() {

    return $('<div>')
        .addClass('selection')
        .addClass('off');

}


//$DOM * Observable bool * ?{?transform: [num, num] -> [num, num]}
// -> {selections: Observable [ [num, num] ] }
function init ($cont, toggle, cfg) {

    debug('init marquee');

    cfg = cfg || {};
    cfg.transform = cfg.transform || _.identity;

    var $elt = createElt();

    //starts false
    var isOn = new Rx.ReplaySubject(1);
    toggle.merge(Rx.Observable.return(false)).subscribe(isOn, makeErrorHandler('on/off'));


    //Effect scene
    $cont.append($elt);
    maintainContainerStyle($cont, isOn);

    var transformAll = function(obj) {
        return _.object(_.map(obj, function (val, key) {
            return [key, cfg.transform(val)];
        }));
    };
    var bounds = marqueeSelections($cont, $elt, isOn);
    var drags = marqueeDrags(bounds, $cont, $elt).map(transformAll);
    var selections = bounds.map(transformAll);

    return {
        selections: selections,
        bounds: bounds,
        drags: drags,
        $elt: $elt,
        isOn: toggle
    };

}


module.exports = init;
