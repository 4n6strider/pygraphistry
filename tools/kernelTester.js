'use strict';

var Kernel      = require('../dist/kernel.js');
var cljs        = require('../dist/cl.js');
var _           = require('underscore');
var simCl       = require('../dist/SimCL.js');
var RenderNull  = require('../dist/RenderNull.js');
var Q           = require('q');
var log         = require('common/logger.js');
var logger      = log.createLogger('graph-viz:tools:kerneltester');

// Things to do:
// Read back from buffer.
// Properly set values in buffer


var KernelTester = function (name, fileName, clContext) {
    this.name = name;
    this.clContext = clContext;
    this.fileName = fileName;

    this.numWorkGroups = 1;
    this.workGroupSize = 256;
    this.argTypes = {};
    this.argNames = [];
    this.argValues = {};
    this.buffersToMake = {};
};


KernelTester.prototype.exec = function () {
    var that = this;
    var kernel = new Kernel(this.name, this.argNames,
            this.argTypes, this.fileName, this.clContext);

    // Make temp buffers
    var bufferOrig = [];
    var bufferPromises = [];
    var bufferKeys = [];
    _.each(_.keys(that.buffersToMake), function (key) {
        var orig = that.buffersToMake[key];
        bufferKeys.push(key);
        bufferOrig.push(orig);
        bufferPromises.push(that.clContext.createBuffer(
            (orig.length) * Float32Array.BYTES_PER_ELEMENT, key));
    })

    return Q.all(bufferPromises)
        .spread(function () {

            // Copy into argValues.
            _.each(arguments, function (arg, idx) {
                arg.write(bufferOrig[idx]);
                that.argValues[bufferKeys[idx]] = arg.buffer;
            });

            // Set arguments
            var setObj = {};
            _.each(that.argNames, function (name) {
                setObj[name] = that.argValues[name];
            });
            kernel.set(setObj);


        }).then(function () {

            var startTime = process.hrtime();
            var diff = 0;
            kernel.exec([that.numWorkGroups], [], [that.workGroupSize])
                .then(function () {
                    that.clContext.queue.finish();
                    diff = process.hrtime(startTime);

                    // Print out all relevant stuff.
                    logger.info('Finished executing ' + that.name + ' in ' +
                        diff[0] + ' seconds and ' + diff[1] + ' nano seconds.');
                    // TODO: Read back and print buffers out.
                }).fail(log.makeQErrorHandler(logger, "Error on Execution"));

        }).fail(log.makeQErrorHandler(logger, "Error on Spread"));
};

KernelTester.prototype.setNumWorkGroups = function (num) {
    this.numWorkGroups = num;
};

KernelTester.prototype.setWorkGroupSize = function (size) {
    this.workGroupSize = size;
};

// Null if buffer.
KernelTester.prototype.setArgTypes = function (argTypesObj) {
    var that = this;
    _.each(_.keys(argTypesObj), function (key) {
        that.argTypes[key] = argTypesObj[key];
    });
};

KernelTester.prototype.setArgNames = function (argNameArray) {
    this.argNames = argNameArray;
};

// Must set arg values after arg types.
// Currently assumes all buffers exist as 32bit values.
KernelTester.prototype.setArgValues = function (argValuesObj) {
    var that = this;
    _.each(_.keys(argValuesObj), function (key) {
        // TODO: Convert to appropriate type and load onto GPU/buffer.
        if (that.argTypes[key] !== null) {
            that.argValues[key] = argValuesObj[key];
        } else {
            that.buffersToMake[key] = argValuesObj[key];
        }
    });
};

function makeZeroFilledArray(length) {
    return Array.apply(null, new Array(length)).map(Number.prototype.valueOf,0);
}



function mainTestFunction (clContext) {

    var tester = new KernelTester('segReduce', 'segReduce.cl', clContext);

    var argNames = ['scalingRatio', 'gravity', 'edgeInfluence', 'flags',
            'numInput', 'input', 'edgeStartEndIdxs', 'segStart', 'workList',
            'numOutput', 'carryOut_global', 'output', 'partialForces'
    ];

    var argTypes = {
        scalingRatio: cljs.types.float_t,
        gravity: cljs.types.float_t,
        edgeInfluence: cljs.types.uint_t,
        flags: cljs.types.uint_t,
        numInput: cljs.types.uint_t,
        input: null,
        edgeStartEndIdxs: null,
        segStart: null,
        workList: null,
        numOutput: cljs.types.uint_t,
        carryOut_global: null,
        output: null,
        partialForces: null
    };

    var numWorkGroups = 256;
    var workGroupSize = 256;

    ////////////////////////
    // Values for arguments
    ////////////////////////

    var input = new Float32Array([1,1,2,2,3,3,1,1,2,2,3,3]); // Double length so 6
    var numInput = input.length / 2;
    var edgeStartEndIdxs = new Uint32Array([0,1,1,4,4,6]); // Right side is exclusive
    var segStart = new Uint32Array([0,1,4]);
    var workList = new Uint32Array([0]);
    var numOutput = segStart.length;
    var carryOut_global = new Float32Array(makeZeroFilledArray(numOutput*2));
    var output = new Float32Array(makeZeroFilledArray(numOutput*2));
    var partialForces = new Float32Array(makeZeroFilledArray(numOutput*2));


    var argValues = {
        scalingRatio: 1.0,
        gravity: 1.0,
        edgeInfluence: 0.0,
        flags: 0,
        numInput: numInput,
        input: input,
        edgeStartEndIdxs: edgeStartEndIdxs,
        segStart: segStart,
        workList: workList,
        numOutput: numOutput,
        carryOut_global: carryOut_global,
        output: output,
        partialForces: partialForces
    };

    tester.setNumWorkGroups(numWorkGroups);
    tester.setWorkGroupSize(workGroupSize);
    tester.setArgNames(argNames);
    tester.setArgTypes(argTypes);
    tester.setArgValues(argValues);

    // Usage for multiple kernels in a row.
    //
    // tester.exec()
    //     .then(function () {
    //         return tester2.exec();
    //     }).then(function () {
    //         return tester3.exec();
    //     }).fail(log.makeQErrorHandler(logger, "Error on Spread"));

    tester.exec()

}



if (require.main === module) {
    logger.info('\nRunning kernelTester in standalone mode.');

    var DEVICE = 'gpu';
    var VENDOR = 'default';

    RenderNull.create(null)
        .then(function (renderer) {
            cljs.create(renderer, DEVICE, VENDOR)
                .then(function (clContext) {
                    mainTestFunction(clContext);
                });
        });
}

module.exports = KernelTester;
