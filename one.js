/*jslint node: true */

"use strict";

var Wikifier = require('./Wikifier.js').Wikifier;

var render = function(args) {
    var wikifier = new Wikifier()
        , title = args[0]
        , contextURI = args[1]
        , authToken = args[2] || ''
        , renderer = wikifier.render(title, contextURI, authToken);
    console.warn('attempting render on ' + title + ' in ' + contextURI);
    return renderer;
};

var doRender = function(args) {
    var renderer = render(args.slice(2));
    renderer.on('output', function(content) {
        console.log('############content', content);
    });
    renderer.on('error', function(errmsg) {
        console.error('error on render', args, errmsg);
    });
}

doRender(process.argv);
