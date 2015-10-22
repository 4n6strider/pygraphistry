'use strict';

var Q = require('q');
var _ = require('underscore');
var fs = require('fs');
var pb = require('protobufjs');
var path = require('path');

var config  = require('config')();
var util = require('../util.js');
var weakcc = require('../weaklycc.js');
var palettes = require('../palettes.js');

var log         = require('common/logger.js');
var logger      = log.createLogger('graph-viz:data:vgraphloader');
var perf        = require('common/perfStats.js').createPerfMonitor();

var builder = pb.loadProtoFile(path.resolve(__dirname, 'graph_vector.proto'));
if (builder === null) {
    logger.die('Could not find protobuf definition');
}
var pb_root = builder.build();

var VERTEX = pb_root.VectorGraph.AttributeTarget.VERTEX;
var EDGE   = pb_root.VectorGraph.AttributeTarget.EDGE;

var decoders = {
    0: decode0
}

//introduce mapping names, and for each, how to send mapped buffer to NBody.js
var attributeLoaders = function(graph) {
    return {
        pointTag: {
            load: graph.setPointTags,
            type: 'number',
            default: graph.setPointTags,
            target: VERTEX,
            values: undefined
        },
        edgeTag: {
            load: graph.setEdgeTags,
            type: 'number',
            default: graph.setEdgeTags,
            target: EDGE,
            values: undefined
        },
        pointSize: {
            load: graph.setSizes,
            type : 'number',
            default: graph.setSizes,
            target: VERTEX,
            values: undefined
        },
        pointColor: {
            load: graph.setColors,
            type: 'number',
            default: graph.setColors,
            target: VERTEX,
            values: undefined
        },
        edgeColor: {
            load: graph.setEdgeColors,
            type: 'number',
            default: graph.setEdgeColors,
            target: EDGE,
            values: undefined
        },
        edgeHeight: {
            load: graph.setEdgeHeights,
            type: 'number',
            default: graph.setEdgeHeights,
            target: EDGE,
            values: undefined
        },
        midEdgeColor: {
            load: graph.setMidEdgeColors,
            type: 'number',
            default: graph.setMidEdgeColors,
            target: EDGE,
            values: undefined
        },
        edgeColor2: {
            load: graph.setEdgeColors,
            type: 'number',
            default: graph.setEdgeColors,
            target: EDGE,
            values: undefined
        },
        pointLabel: {
            load: graph.setPointLabels,
            type: 'string',
            target: VERTEX,
            values: undefined
        },
        edgeLabel: {
            load: graph.setEdgeLabels,
            type: 'string',
            target: EDGE,
            values: undefined
        },
        edgeWeight: {
          load: graph.setEdgeWeight,
          type: 'number',
          target: EDGE,
          default: graph.setEdgeWeight,
          values: undefined
        }
    };
}

/**
 * Load the raw data from the dataset object from S3
**/
function load(graph, dataset) {
    var vg = pb_root.VectorGraph.decode(dataset.body)
    logger.trace('attaching vgraph to simulator');
    graph.simulator.vgraph = vg;
    return decoders[vg.version](graph, vg, dataset.metadata);
}

function loadDataframe(graph, attrs, numPoints, numEdges) {
    var edgeAttrsList = _.filter(attrs, function (value) {
        return value.target === EDGE;
    });
    var pointAttrsList = _.filter(attrs, function (value) {
        return value.target === VERTEX;
    });

    var edgeAttrs = _.object(_.map(edgeAttrsList, function (value) {
        return [value.name, value];
    }));

    var pointAttrs = _.object(_.map(pointAttrsList, function (value) {
        return [value.name, value];
    }));

    graph.dataframe.load(edgeAttrs, 'edge', numEdges);
    graph.dataframe.load(pointAttrs, 'point', numPoints);
}

function getAttributes(vg, attributes) {
    var vectors = vg.string_vectors.concat(vg.int32_vectors, vg.double_vectors);
    var attrs = [];
    for (var i = 0; i < vectors.length; i++) {
        var v = vectors[i];
        if (v.values.length > 0 && (!attributes || attributes.length === 0 || attributes.indexOf(v.name) > -1) ) {
            attrs.push({
                name: v.name,
                target : v.target,
                type: typeof(v.values[0]),
                values: v.values
            });
        }
    }
    return attrs;
}

function decode0(graph, vg, metadata)  {
    logger.debug('Decoding VectorGraph (version: %d, name: %s, nodes: %d, edges: %d)',
          vg.version, vg.name, vg.nvertices, vg.nedges);

    var attrs = getAttributes(vg);
    loadDataframe(graph, attrs, vg.nvertices, vg.nedges);
    logger.debug('Graph has attribute: %o', _.pluck(attrs, 'name'));
    var vertices = [];
    var edges = new Array(vg.nedges);
    var dimensions = [1, 1];

    for (var i = 0; i < vg.edges.length; i++) {
        var e = vg.edges[i];
        edges[i] = [e.src, e.dst];
    }


    // Do the vertices already exist in the serialized version?
    var xObj = _.find(vg.double_vectors, function (o) { return o.name === 'x'; });
    var yObj = _.find(vg.double_vectors, function (o) { return o.name === 'y'; });

    // Load vertices from protobuf Vertex message
    if (xObj && yObj) {
        logger.trace('Loading previous vertices from xObj');
        for (var i = 0; i < vg.nvertices; i++) {
            vertices.push([xObj.values[i], yObj.values[i]]);
        }
    } else {
        logger.trace('Running component analysis');

        var components = weakcc(vg.nvertices, edges, 2);
        var pointsPerRow = vg.nvertices / (Math.round(Math.sqrt(components.components.length)) + 1);

        perf.startTiming('graph-viz:data:vgraphloader, weakcc postprocess');
        var componentOffsets = [];
        var cumulativePoints = 0;
        var row = 0;
        var col = 0;
        var pointsInRow = 0;
        var maxPointsInRow = 0;
        var rowYOffset = 0;
        var rollingMax = 0;
        for (var i = 0; i < components.components.length; i++) {

            maxPointsInRow = Math.max(maxPointsInRow, components.components[i].size);

            componentOffsets.push({
                rollingSum: cumulativePoints,
                rowYOffset: rowYOffset,
                rowRollingSum: pointsInRow,
                rollingMaxInRow: maxPointsInRow,
                row: row,
                col: col
            });

            cumulativePoints += components.components[i].size;
            if (pointsInRow > pointsPerRow) {
                row++;
                rowYOffset += maxPointsInRow;
                col = 0;
                pointsInRow = 0;
                maxPointsInRow = 0;
            } else {
                col++;
                pointsInRow += components.components[i].size;
            }
        }
        for (var i = components.components.length - 1; i >= 0; i--) {
            components.components[i].rowHeight =
                Math.max(components.components[i].size,
                    i + 1 < components.components.length
                    && components.components[i+1].row == components.components[i].row ?
                        components.components[i].rollingMaxInRow :
                        0);
        }

        var initSize = 5 * Math.sqrt(vg.nvertices);
        for (var i = 0; i < vg.nvertices; i++) {
            var c = components.nodeToComponent[i];
            var offset = componentOffsets[c];
            var vertex = [ initSize * (offset.rowRollingSum + 0.9 * components.components[c].size * Math.random()) / vg.nvertices ];
            for (var j = 1; j < dimensions.length; j++) {
                vertex.push(initSize * (offset.rowYOffset + 0.9 * components.components[c].size * Math.random()) / vg.nvertices);
            }
            vertices.push(vertex);
        }
        perf.endTiming('graph-viz:data:vgraphloader, weakcc postprocess');
    }

    var loaders = attributeLoaders(graph);
    var mapper = mappers[metadata.mapper];
    if (!mapper) {
        logger.warn('Unknown mapper', metadata.mapper, 'using "default"');
        mapper = mappers['default'];
    }
    loaders = wrap(mapper.mappings, loaders);
    logger.trace('Attribute loaders: %o', loaders);

    _.each(attrs, function (attr) {
        var vname = attr.name;
        if (!(vname in loaders)) {
            logger.debug('Skipping unmapped attribute', vname);
            return;
        }

        var loaderArray = loaders[vname];

        _.each(loaderArray, function (loader) {
            if (attr.target != loader.target) {
                logger.warn('Vertex/Node attribute mismatch for ' + vname);
            } else if (attr.type != loader.type) {
                logger.warn('Expected type ' + loader.type + ' but got ' + attr.type + ' for' + vname);
            } else {
                loader.values = attr.values;
            }
        });

    });

    // Create map from attribute name -> type
    vg.attributeTypeMap = createAttributeTypeMap([[vg.string_vectors, 'string'],
            [vg.int32_vectors, 'int32'], [vg.double_vectors, 'double']]);


    return graph.setVertices(vertices)
    .then(function () {
        return graph.setEdges(edges);
    }).then(function () {
        return runLoaders(loaders);
    }).then(function () {
        return graph;
    }).fail(log.makeQErrorHandler(logger, 'Failure in VGraphLoader'));
}


function getAttributeType (vg, attribute) {
    return vg.attributeTypeMap[attribute];
}


function createAttributeTypeMap (pairs) {
    var map = {};
    _.each(pairs, function (pair) {
        var vectors = pair[0];
        var typeName = pair[1];
        var attributes = _.pluck(vectors, 'name');
        _.each(attributes, function (attr) {
            map[attr] = typeName;
        })
    });
    return map;
}


function runLoaders(loaders) {
    var promises = _.map(loaders, function (loaderArray, aname) {
        return _.map(loaderArray, function (loader) {
            if (loader.values) {
                return loader.load(loader.values);
            } else if (loader.default) {
                return loader.default();
            } else {
                return Q();
            }
        });
    });
    var flatPromises = _.flatten(promises, true);
    return Q.all(flatPromises);
}

var testMapper = {
    mappings: {
        pointTag: {
            name: 'nodeTag'
        },
        edgeTag: {
            name: 'edgeTag'
        },
        pointSize: {
            name: 'degree',
            transform: function (v) {
                return normalize(logTransform(v), 5, Math.pow(2, 8))
            }
        },
        pointTitle: {
            name: 'label'
        },
        pointColor: {
            name: 'community_spinglass',
            transform: function (v) {
                var palette = util.palettes.qual_palette2;
                return int2color(normalize(v, 0, palette.length - 1), palette);
            }
        },
        edgeColor: {
            name: 'bytes',
            transform: function (v) {
                var palette = util.palettes.green2red_palette;
                return int2color(normalize(logTransform(v), 0, palette.length - 1), palette);
            }
        },
        edgeWeight: {
            name: 'weight',
            transform: function (v) {
                return normalizeFloat(logTransform(v), 0.5, 1.5)
            }
        }
    },
}

var testMapperDemo = {
    mappings: _.extend({}, testMapper.mappings, {
        x: {
            name: 'x'
        },
        y: {
            name: 'y'
        }
    }),
}

var misMapper = {
    mappings: _.extend({}, testMapper.mappings, {
        pointSize: {
            name: 'betweeness',
            transform: function (v) {
                return normalize(v, 5, Math.pow(2, 8))
            }
        }
    })
}

var debugMapper = {
    mappings: {
        pointLabel: {
            name: 'label'
        },
        pointSize: {
            name: 'size'
        }
    },
}

var defaultMapper = {
    mappings: {
        pointSize: {
            name: 'pointSize',
            transform: function (v) {
                return normalize(v, 5, Math.pow(2, 8))
            }
        },
        pointLabel: {
            name: 'pointLabel'
        },
        edgeLabel: {
            name: 'edgeLabel'
        },
        pointColor: {
            name: 'pointColor',
            transform: function (v) {
                return _.map(v, function (cat) {
                    return palettes.bindings[cat];
                });
            }
        },
        edgeColor2: {
            name: 'edgeColor2',
            transform: function (v) {
                var palette = util.palettes.qual_palette2;
                return int2color(groupRoundAndClamp(v, 0, palette.length - 1), palette);
            }
        },
        edgeColor: {
            name: 'edgeColor',
            transform: function (v) {
                var palette = util.palettes.green2red_palette;
                return int2color(normalize(v, 0, palette.length - 1), palette);
            }
        },
        edgeHeight: {
            name: 'edgeHeight'
        },
        pointTag: {
            name: 'pointType',
            transform: function (v) {
                return normalize(v, 0, 2);
            }
        },
        edgeTag: {
            name: 'edgeType',
            transform: function (v) {
                return normalize(v, 0, 2);
            }
        },
        edgeWeight: {
            name: 'edgeWeight',
            transform: function (v) {
                return normalizeFloat(v, 0.5, 1.5)
            }
        }
    }
}

function wrap(mappings, loaders) {
    var res = {}
    for (var a in loaders) {
        if (a in mappings) {
            var loader = loaders[a];
            var mapping = mappings[a];

            // Helper function to work around dubious JS scoping
            doWrap(res, mapping, loader);

            logger.trace('Mapping ' + mapping.name + ' to ' + a);
        } else
            res[a] = [loaders[a]];
    }
    return res;
}

function doWrap(res, mapping, loader) {
    var mapped = res[mapping.name] || [];

    if ('transform' in mapping) {
        var oldLoad = loader.load;
        loader.load = function (data) {
            oldLoad(mapping.transform(data));
        }
    }

    mapped.push(loader);
    res[mapping.name] = mapped;
}

var mappers = {
    'opentsdb': testMapper,
    'opentsdbDemo': testMapperDemo,
    'miserables': misMapper,
    'debug': debugMapper,
    'splunk': defaultMapper,
    'default': defaultMapper
}

function logTransform(values) {
    return _.map(values, function (val) {
        return val <= 0 ? 0 : Math.log(val);
    });
}

// rescale array of [a,b] range values to [minimum, maximum]
function normalize(array, minimum, maximum) {
    var max = _.max(array);
    var min = _.min(array);
    var scaleFactor = (maximum - minimum) / (max - min + 1);

    return _.map(array, function (val) {
        return minimum + Math.floor((val - min) * scaleFactor);
    });
}

// rescale array of [a,b] range value to [minimum, maximum] with floats
function normalizeFloat(array, minimum, maximum) {
    var max = _.max(array);
    var min = _.min(array);
    var scaleFactor = (maximum - minimum) / (max - min + 1);

    return _.map(array, function (val) {
        return minimum + (val - min) * scaleFactor;
    });
}

// map values to integers between minimum and maximum
function groupRoundAndClamp(array, minimum, maximum) {
    return array.map(function (v) {
        var x = Math.round(v);
        return Math.max(minimum, Math.min(maximum, x));
    });
}

var int2color = util.int2color;

module.exports = {
    load: load,
    getAttributeType: getAttributeType,
    types: {
        VERTEX: VERTEX,
        EDGE: EDGE
    }
};
