'use strict';

var    cljs = require('./cl.js'),
          Q = require('q'),
     Kernel = require('./kernel.js');

var log         = require('common/logger.js');
var logger      = log.createLogger('graph-viz:cl:selectnodes');

function SelectNodes(clContext) {
    logger.trace('Creating selectNodes kernel');

    var args = ['top', 'left', 'bottom', 'right', 'positions', 'mask'];
    var argsType = {
        top: cljs.types.float_t,
        left: cljs.types.float_t,
        bottom: cljs.types.float_t,
        right: cljs.types.float_t,
        positions: null,
        mask:null
    };
    this.selectNodes = new Kernel('selectNodes', args, argsType, 'selectNodes.cl', clContext);
}


SelectNodes.prototype.run = function (simulator, selection, delta) {
    var that = this;
    var numPoints = simulator.dataframe.getNumElements('point');

    if (!that.qMask) {
        that.bytes = numPoints * Uint8Array.BYTES_PER_ELEMENT;
        that.qMask = simulator.cl.createBuffer(that.bytes, 'mask');
    }

    return that.qMask.then(function (mask) {
        logger.trace('Computing selection mask');
        var resources = [simulator.dataframe.getBuffer('curPoints', 'simulator')];

        that.selectNodes.set({
            top: selection.tl.y,
            left: selection.tl.x,
            bottom: selection.br.y,
            right: selection.br.x,
            positions: simulator.dataframe.getBuffer('curPoints', 'simulator').buffer,
            mask: mask.buffer
        });

        simulator.tickBuffers(['nextPoints', 'curPoints']);

        logger.trace('Running selectNodes');
        return that.selectNodes.exec([numPoints], resources)
            .then(function () {
                var result = new Uint8Array(that.bytes);
                return mask.read(result).then(function () {
                    return result;
                });
            }).fail(log.makeQErrorHandler(logger, 'Kernel selectNodes failed'));
    }).fail(log.makeQErrorHandler(logger, 'Node selection failed'));

};

module.exports = SelectNodes;
