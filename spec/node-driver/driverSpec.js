var Rx           = require('rx');
var _            = require('underscore');
var fs           = require('fs');
var path         = require('path');
var driver       = require('../../js/node-driver.js');
var StreamGL     = require('StreamGL');
var compress     = require('node-pigz');
var renderer     = StreamGL.renderer;
var renderConfig = require('../../js/renderer.config.js').scenes.uber;
var loader       = require('../../js/data-loader.js');

describe("Smoke test for server loop", function() {
    var theDataset;
    var activeBuffers;
    var activeBuffers;
    var ticks;

    beforeEach(function() {
        theDataset = loader.downloadDataset({dataset: 'Uber', controls: 'uber',
                                             scene: 'uber', type: 'OBSOLETE_geo'});
        activeBuffers = renderer.getServerBufferNames(renderConfig)
        activePrograms = renderConfig.render;
        ticks = theDataset.then(function(dataset){
            return driver.create(dataset).ticks;
        });
    });

    it("Setup", function (done) {
        var fail = this.fail;

        ticks.then( function (ticks) {
            var tick = ticks.take(1);
            tick.subscribe(function (e) {
                expect(e).not.toBeNull();
                expect(e).toBeDefined();
                done();
            }, fail);
        });
    });

    it("Fetch VBO", function (done) {
        ticks.then(function (ticks) {
            var graph = new Rx.ReplaySubject(1);
            var ticksMulti = ticks.publish();
            ticksMulti.connect();
            ticksMulti.take(1).subscribe(graph);

            var fail = this.fail;

            graph.flatMap(function (graph) {
                return driver.fetchData(graph, renderConfig, compress, activeBuffers, undefined, activePrograms);
            }).take(1).subscribe(function (vbo) {
                expect(vbo).not.toBeNull();
                expect(vbo).toBeDefined();
                done();
            }, fail);
        });
    });
});


