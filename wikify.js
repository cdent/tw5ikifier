/*jslint node: true */

"use strict";

var Wikifier = require('./Wikifier.js').Wikifier
    , server = require('net').createServer({allowHalfOpen: true});

var render = function(args) {
    var wikifier = new Wikifier()
        , title = args[0]
        , contextURI = args[1]
        , authToken = args[2] || ''
        , renderer = wikifier.render(title, contextURI, authToken);
    console.warn('attempting render on ' + title + ' in ' + contextURI);
    return renderer;
};

server.addListener('connection', function(c) {
    var data = '';
    c.addListener('data', function(chunk) {
        data += chunk;
    });
    c.addListener('end', function() {
        var dataString = data.toString().replace(/(\r|\n)+$/, '')
            , args = dataString.split(/\x00/)
            , renderer = render(args);
        renderer.on('output', function(content) {
            c.end(content);
        });
        renderer.on('error', function(errmsg) {
            console.error('error on render', args, errmsg);
            c.end('error attempting to render' + args[0]);
        });
    });
});

server.listen('/tmp/wikify.sock');
server.maxConnections = 20;
