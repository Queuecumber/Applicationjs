define(['knockout', 'jquery'],
function (ko, $)
{
    'use strict';

    // Add the 'binding' property to jquery event objects for certain events
    // to get the currently bound object easier
    function addBindingProperty(e)
    {
        if(!e.binding)
        {
            e.binding = ko.dataFor(e.target);
        }

        return e;
    }

    var fixedEvents = [
        'blur',
        'change',
        'click',
        'dblclick',
        'focus',
        'focusin',
        'focusout',
        'hover',
        'keydown',
        'keypress',
        'keyup',
        'mousedown',
        'mouseenter',
        'mouseleave',
        'mousemove',
        'mouseout',
        'mouseover',
        'mouseup',
        'resize',
        'scroll',
        'select',
        'submit'
    ];

    fixedEvents.forEach(function (ename)
    {
        var fhObj = {};
        if($.event.fixHooks[ename])
        {
            fhObj = $.event.fixHooks[ename];
        }

        if(!fhObj.filter)
        {
            fhObj.filter = addBindingProperty;
        }
        else
        {
            var originalFilter = fhObj.filter;
            fhObj.filter = function(e, oe)
            {
                e = originalFilter(e,oe);
                return addBindingProperty(e);
            };
        }

        $.event.fixHooks[ename] = fhObj;
    });

    // Add the guard and sentinel binding handlers
    ko.bindingHandlers.guard = {
        init: function(element, valueAccessor, allBindings, viewModel, bindingContext)
        {
            var redirect = ko.observable();
            var fallback = {};

            if(allBindings.has('sentinel'))
                fallback = allBindings.get('sentinel');

            // Trick: since we can't share a state between the init and update
            // functions (the redirect and fallback variables are the state),
            // keep the state local and use a ko.computed. The ko.computed
            // function is called whenever any observable it reads is updated,
            // regardless of whether or not it is attached to a view, allowing
            // us to catch updates to the binding without providing an update
            // function AND to keep our state.
            ko.computed(function() {
                var value = valueAccessor();
                var valueUnwrapped = ko.unwrap(value);

                if(valueUnwrapped)
                {
                    redirect(valueUnwrapped);
                }
                else
                {
                    redirect(fallback);
                }
            }, null, { disposeWhenNodeIsRemoved: element });

            // Another trick: bind descendants to our observable and switch its value
            // so that we can supply whatever we want to the child nodes
            ko.applyBindingsToDescendants(bindingContext.createChildContext(redirect), element);

            return { controlsDescendantBindings: true };
        }
    };

    // Add the activate binding handler
    var activationParameters = {};
    ko.bindingHandlers.activate = {
        update: function(element, valueAccessor, allBindings, viewModel, bindingContext)
        {
            var guid = $(element).prop('id');

            var value = valueAccessor();
            var activationParameter = ko.unwrap(value);

            activationParameters[guid] = activationParameter;
        }
    };

    // Add some extra Array functions
    // Flatten an array of arrays (with any depth of arrays) into a single array
    Array.prototype.flatten = function ()
    {
        return this.reduce(function (flat, toFlatten)
        {
            if(Array.isArray(toFlatten) && toFlatten.some(Array.isArray))
                return flat.concat(toFlatten.flatten());
            else
                return flat.concat(toFlatten);
        }, []);
    };

    // Polyfill Array.prototype.find to find an element matching a callback
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/find#Polyfill
    if (!Array.prototype.find) {
      Object.defineProperty(Array.prototype, 'find', {
        enumerable: false,
        configurable: true,
        writable: true,
        value: function(predicate) {
          if (this === null) { // Minor correction to this line to fix jshint error
            throw new TypeError('Array.prototype.find called on null or undefined');
          }
          if (typeof predicate !== 'function') {
            throw new TypeError('predicate must be a function');
          }
          var list = Object(this);
          var length = list.length >>> 0;
          var thisArg = arguments[1];
          var value;

          for (var i = 0; i < length; i++) {
            if (i in list) {
              value = list[i];
              if (predicate.call(thisArg, value, i, list)) {
                return value;
              }
            }
          }
          return undefined;
        }
      });
    }

    // Add extra Object functions
    // Get an array of the values in an object
    Object.values = function (obj)
    {
        return Object.keys(obj).map(function (key) { return obj[key]; });
    };

    // Turn an object into an array of key-value pairs with each element in the form [key, value]
    Object.pairs = function (obj)
    {
        return Object.keys(obj).map(function (key) { return [key, obj[key]]; });
    };

    // Application public interface
    var application = {

        guid: {
            newGuid: function ()
            {
                return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c)
                {
                    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
                    return v.toString(16);
                });
            }
        },

        model: ko.observable({}),

        name: ko.observable(''),

        components: ko.observableArray([]),

        visible: ko.observable(true),

        children: function ()
        {
            // Grab direct children
            var children =  Object.values(this)
                            .filter(ko.isObservable)
                            .filter(function (obs)
                            {
                                return obs() instanceof application.ViewModel;
                            })
                            .map(function (vm)
                            {
                                return vm();
                            });

            // Grab children in collections
            var collectionChildren =   Object.values(this)
                                      .filter(ko.isObservable)
                                      .filter(function (prop) { return prop() instanceof application.ViewModelCollection; })
                                      .map(function (vmc) { return vmc().viewModels(); })
                                      .flatten()
                                      .map(function (vm)
                                      {
                                          return vm();
                                      });

            // Merge the two lists
            return children.concat(collectionChildren);
        },

        // Composes the page and applies data bindings
        compose: function (components)
        {
            $('body').attr('data-bind', 'visible: visible');

            if(!components)
            {
                $.ajaxSetup({ async: false });
                $.getJSON('/components.json', function (c) { components = c; });
                $.ajaxSetup({ async: true });
            }

            this.components(components);
            loadComponents((function()
            {
                // Apply initial component types
                typeComponents($('body'));

                // get the top level components for expansion
                var topLevelComponents = findChildComponents($('body'));

                // prepare the application object for top-level collection components
                var topLevelCollections = topLevelComponents.filter(function (component)
                {
                    return $(component).data('componentType') == 'collection';
                });
                prepareCollections(topLevelCollections, this);

                // expand the viewmodel heirarchy
                var expandedModels = expandComponents(topLevelComponents);

                // trigger loaded event from bottom up
                expandedModels.reverse();
                expandedModels.forEach(function (comp) { comp.loaded.trigger(); });

                // Apply databindings
                ko.applyBindings(this);

                // Trigger that the application as a whole is loaded
                this.loaded.trigger();

                // Activate any immediate children that are set to auto-activate
                this.children().forEach(function (vm)
                {
                    var instanceInfo = getComponentInstanceInfo(vm.view());
                    if(!vm.active() && vm.view && instanceInfo.activate !== undefined)
                    {
                        if(vm.uid in activationParameters)
                        {
                            vm.activate(activationParameters[vm.uid]);
                        }
                        else
                        {
                            vm.activate();
                        }
                    }
                });

            }).bind(this));
        },

        // Find an component by id using a depth first search (recursive)
        find: function (componentId)
        {
            var target = null;

            this.children().forEach(function (child)
            {
                var foundChild = null;
                if (child.uid == componentId)
                {
                    foundChild = child;
                }
                else
                {
                    foundChild = child.find(componentId);
                }

                if (foundChild !== null)
                {
                    target = foundChild;
                }
            });

            return target;
        },

        // Inject a component dynamically
        injectComponent: function (component)
        {
            // Expand the component into the DOM
            var viewModels = expandComponent(component);
            viewModels.reverse();

            // Trigger loaded handlers from the bottom up
            viewModels.forEach(function (vm) { vm.loaded.trigger(); });

            // Apply bindings to the root level injected node using its parent
            var parent = viewModels.reverse()[0].parent();
            ko.applyBindingsToNode(component, null, parent);

            // Return the root of the injected componentsQueue
            return viewModels[0];
        },

        // Event prototype
        Event: function ()
        {
            // Generate a unique id if one was not provided
            this.id = application.guid.newGuid();

            // Attaches an event handler
            this.on = (function ()
            {
                var args = $.makeArray(arguments);

                return $(this).on.apply($(this), [this.id].concat(args));
            }).bind(this);

            // Detaches an event handler
            this.off = (function ()
            {
                var args = $.makeArray(arguments);

                return $(this).off.apply($(this), [this.id].concat(args));
            }).bind(this);

            // Triggers the event
            this.trigger = (function ()
            {
                return $(this).triggerHandler(this.id, arguments);
            }).bind(this);
        },

        RoutedEvent: function ()
        {
            // Track the routed signal using a private event that can only be triggered internally
            var event = new application.Event();

            // Triggers the routed events
            var triggerRoute = (function ()
            {
                var argsWithoutEvent = $.makeArray(arguments).slice(1);
                event.trigger.apply(this, argsWithoutEvent);
            }).bind(this);

            // Adds an event whose signal will be routed
            this.addRoute = (function (ev)
            {
                ev.on(triggerRoute);
            }).bind(this);

            // Removes an event from routing
            this.removeRoute = (function (ev)
            {
                ev.off(triggerRoute);
            }).bind(this);

            // Allow turning on and off subscriptions to the routed signals
            this.on = event.on;
            this.off = event.off;
        },

        // Viewmodel prototype parent
        ViewModel: function ()
        {
            // Observable property controls visibility
            this.visible = ko.observable(false);

            // Parent, children, and find child function
            this.parent = ko.observable({});
            this.children = application.children;
            this.find = application.find;

            // Loaded event, fired after the components view is added and its viewmodel is set up
            this.loaded = new application.Event();

            // Tracks if a component is active, not settable
            var isActive = false;
            this.active = function () { return isActive; }; // Tracks if the component is active

            // Activates the component, any number of arguments can be passed to the activation handlers
            this.activate = function ()
            {
                // Only activate a component if its view exists in the DOM
                if(this.view().length > 0)
                {
                    var instanceInfo = getComponentInstanceInfo(this.view());

                    this.visible(true);
                    isActive = true;

                    if (this.view && instanceInfo.type == 'collection')
                    {
                        var data = ko.dataFor(this.view().get(0));

                        var args = $.makeArray(arguments);

                        var params = args.concat(data);
                        this.activated.trigger.apply(this.activated, params);
                    }
                    else
                    {
                        this.activated.trigger.apply(this.activated, arguments);
                    }

                    this.children().forEach(function (vm)
                    {
                        var cii = getComponentInstanceInfo(vm.view());
                        if(!vm.active() && vm.view && cii.activate !== undefined)
                        {
                            if(vm.uid in activationParameters)
                            {
                                vm.activate(activationParameters[vm.uid]);
                            }
                            else
                            {
                                vm.activate();
                            }
                        }
                    });
                }
            };
            this.activated = new application.Event(); // Activated event

            // Finishes the component, any number of arguments can be passed to the finish handlers
            this.finish = function ()
            {
                this.visible(false);
                isActive = false;
                this.finished.trigger.apply(this.finished, arguments);

            	this.children().forEach(function (vm)
            	{
        			if(vm.active())
            			vm.finish();
            	});
            };
            this.finished = new application.Event(); // Finish event

            // Unique identifier
            this.uid = application.guid.newGuid();

            // Gets the root of the components view
            this.view = (function () { return $('#' + this.uid); }).bind(this);

            // Removes the component's view which triggers removal of the entire component, this will
            // happen automatically (along with triggering of any events) when the DOM observer
            // catches this change
            this.remove = (function () { this.view().remove(); }).bind(this);
            this.removed = new application.Event(); // Removed event
            this.childRemoved = new application.Event(); // Child removed event

            function filterProperties(filterFunction)
            {
                /*jshint validthis:true */
                return  Object.pairs(this)
                        .map(function (pair)
                        {
                            return { name: pair[0], property: pair[1] };
                        })
                        .filter(filterFunction);
            }

            // Gets any events attached to the viewmodel
            this.events = function ()
            {
                return filterProperties.call(this, function (desc)
                {
                    return desc.property instanceof application.Event;
                });
            };

            // Get functions of the viewmodel
            this.functions = function ()
            {
                return filterProperties.call(this, function (desc)
                {
                    return typeof(desc.property) == 'function' && !ko.isObservable(desc.property);
                });
            };

            this.observables = function ()
            {
                return filterProperties.call(this, function (desc)
                {
                    return ko.isObservable(desc.property);
                });
            };

            // Get non-function, non-event proprties of the viewmodel
            this.properties = function ()
            {
                return filterProperties.call(this, function (desc)
                {
                    return typeof(desc.property) != 'function' && !(desc.property instanceof application.Event);
                });
            };
        },

        // Manages a collection of viewmodels
        ViewModelCollection: function (CollectionType)
        {
            // Get a prototype of the components this collection will manage
            var collectionPrototype = new CollectionType();

            // Create routed events for any of the user defined events so that handlers can be attached collection-wide
            var events = collectionPrototype.events();
            events.forEach(function (ev)
            {
                this[ev.name] = new application.RoutedEvent();
            }, this);

            // Create functions that can be called collection wide
            var functions = collectionPrototype.functions();
            functions.forEach(function (f)
            {
                this[f.name] = function ()
                {
                    var args = $.makeArray(arguments);
                    var returns = [];
                    this.viewModels().forEach(function (vm)
                    {
                        var ret = vm()[f.name].apply(vm(), args);
                        returns.push(ret);
                    });

                    return returns;
                };
            }, this);

            // Create observables that can be get/set collection wide
            var observables = collectionPrototype.observables();
            observables.forEach(function (o)
            {
                this[o.name] = function (val)
                {
                    if(val !== undefined)
                    {
                        this.viewModels().forEach(function (vm)
                        {
                            vm()[o.name](val);
                        });
                    }
                    else
                    {
                        var vals = [];
                        this.viewModels().forEach(function (vm)
                        {
                            vals.push(vm()[o.name]());
                        });

                        return vals;
                    }
                };
            }, this);

            // Create properties that can be get/set collection wide
            var properties = collectionPrototype.properties();
            var addedProperties = [];
            properties.forEach(function (p)
            {
                var vmc = this;

                Object.defineProperty(this, p.name, {
                    enumerable: true,
                    get: function ()
                    {
                        var vals = [];
                        vmc.viewModels().forEach(function (vm)
                        {
                            vals.push(vm()[p.name]);
                        });

                        return vals;
                    },

                    set: function (val)
                    {
                        vmc.viewModels().forEach(function (vm)
                        {
                            vm()[p.name] = val;
                        });
                    }
                });

                addedProperties.push(p.name);

            }, this);

            // Gets the viewmodels in the collection
            this.viewModels = function ()
            {
                // Remove properties added as children to avoid infinite recursion
                var safeProperties = [];
                for(var key in this)
                {
                    if(addedProperties.indexOf(key) == -1)
                        safeProperties.push(key);
                }

                return  safeProperties.map(function (name)
                        {
                            return this[name];
                        }, this)
                        .filter(ko.isObservable)
                        .filter(function (prop)
                        {
                            return prop() instanceof application.ViewModel;
                        });
            };

            // Activate all viewmodels in the collection
            this.activate = (function ()
            {
                var args = arguments;

                this.viewModels().forEach(function (vm)
                {
                    vm().activate.apply(vm(), args);
                });
            }).bind(this);
            this.activated = new application.RoutedEvent();

            // Finish all viewmodels in the collection
            this.finish = (function ()
            {
                var args = arguments;

                this.viewModels().forEach(function (vm)
                {
                    vm().finish.apply(vm(), args);
                });
            }).bind(this);
            this.finished = new application.RoutedEvent();

            // Add a viewmodel to the collection
            this.viewModelAdded = new application.Event();
            this.add = (function (vm)
            {
                // Route user events
                vm.events().forEach(function (ev)
                {
                    if (ev.name in this)
                    {
                        this[ev.name].addRoute(ev.property);
                    }
                }, this);

                // Route standard events
                this.loaded.addRoute(vm.loaded);
                this.activated.addRoute(vm.activated);
                this.finished.addRoute(vm.finished);
                this.removed.addRoute(vm.removed);
                this.childRemoved.addRoute(vm.childRemoved);

                // Add to the collection
                this[vm.uid] = ko.observable(vm);

                this.viewModelAdded.trigger(vm);

            }).bind(this);
            this.loaded = new application.RoutedEvent();

            // Remove a viewmodel from the collection
            this.viewModelRemoved = new application.Event();
            this.remove = (function (vm)
            {
                // Make sure the component is in the collection
                if (vm.uid in this)
                {
                    // Remove the component
                    delete this[vm.uid];

                    // Remove routing for standard event handlers
                    this.loaded.removeRoute(vm.loaded);
                    this.activated.removeRoute(vm.activated);
                    this.finished.removeRoute(vm.finished);
                    this.removed.removeRoute(vm.removed);
                    this.childRemoved.removeRoute(vm.childRemoved);

                    // Remove routing for user events
                    vm.events().forEach(function (ev)
                    {
                        if (ev.name in this)
                        {
                            this[ev.name].removeRoute(ev.property);
                        }
                    }, this);

                    this.viewModelRemoved.trigger(vm);
                }
            }).bind(this);
            this.removed = new application.RoutedEvent();
            this.childRemoved = new application.RoutedEvent();
        }
    };

    // Application events
    application.loaded = new application.Event();   // Triggered when the application is finished loading

    application.childRemoved = new application.Event(); // Triggered when a direct child of Application is removed

    // Application private interface

    // Loads view templates and styles for each component
    function _loadComponents(callback)
    {
        /*jshint validthis:true */

        // Put JQuery AJAX into synchronous mode for this algorithm to work, we will clear this flag once page loading is complete
        $.ajaxSetup({ async: false });

        var viewmodelPaths = [];
        var viewmodelIdx = [];

        // Preload styles and templates for each component
        this.components().forEach(function (comp, i)
        {
            // Register a custom element type
            if(comp.name.indexOf('-') !== -1)
            {
                comp.name = comp.name.toLowerCase();
                var ce = document.registerElement(comp.name);
                comp.element = ce;
            }

            // Append the style node to the pages head
            if ('style' in comp)
            {
                var styleLink = $('<link rel="stylesheet" type="text/css" href="' + comp.style + '"/>');
                $('head').append(styleLink);
            }

            // Load the view template and store it for later
            $.get(comp.view, {}, function (viewData)
            {
                comp.template = viewData;
            });

            if(typeof comp.viewModel == 'string')
            {
                viewmodelPaths.push(comp.viewModel);
                viewmodelIdx.push(i);
            }
        });

        // Put JQuery back into asynchronous mode for future ajax requests
        $.ajaxSetup({ async: true });

        if(viewmodelPaths.length > 0)
        {
            // Dynamically load missing viewmodels
            require(viewmodelPaths, (function ()
            {
                for(var i = 0; i < arguments.length; i++)
                {
                    this.components()[viewmodelIdx[i]].viewModel = arguments[i];
                }

                callback();
            }).bind(this));
        }
        else
        {
            callback();
        }
    }
    var loadComponents = _loadComponents.bind(application);

    function _findChildComponents(componentRoot)
    {
        var childComponentsData = componentRoot.find('[data-component]').toArray();
        var childComponentsCustom = componentRoot.find(this.components().map(function (c) { return c.name; }).join(',')).toArray();

        return childComponentsData.concat(childComponentsCustom);
    }
    var findChildComponents = _findChildComponents.bind(application);

    function _isComponentRoot(element)
    {
        var isDataElement = element.data().hasOwnProperty('component');

        if(isDataElement)
            return true;

        var tagName = element.prop('tagName');

        if(tagName)
        {
            var componentName = tagName.toLowerCase();

            return this.components().map(function (c) { return c.name; }).indexOf(componentName) > -1;
        }

        return false;
    }
    var isComponentRoot = _isComponentRoot.bind(application);

    function _getComponentInstanceInfo(componentRoot)
    {
        var isDataElement = componentRoot.data().hasOwnProperty('component');

        var component = isDataElement ? componentRoot.data('component') : componentRoot.prop('tagName').toLowerCase();
        var name = isDataElement ? componentRoot.data('name') : componentRoot.attr('name');
        var type = componentRoot.data('componentType');
        var activate = isDataElement ? componentRoot.data('activate') : componentRoot.attr('activate');

        return {
            component: component,
            name: name,
            type: type,
            activate: activate
        };
    }
    var getComponentInstanceInfo = _getComponentInstanceInfo.bind(application);

    // Shorthand to expand a single component
    // returns a tree structure in an array of the expanded components
    function _expandComponent(component)
    {
        return expandComponents([component]);
    }
    var expandComponent = _expandComponent.bind(application);

    // Expands a data-component element into its component, uses a breadth-first traversal
    // Returns a list of the constructed view models that were expanded
    function _expandComponents(components)
    {
        /*jshint validthis:true */

        var componentsQueue = components;
        var viewModels = [];

        var enqueueComponent = function (c) { componentsQueue.push(c); };
        var matchComponentName = function (cname, c) { return c.name.toLowerCase() == cname.toLowerCase(); };
        while (componentsQueue.length > 0)
        {
            var componentRoot = $(componentsQueue.shift()); // dequeue operation

            // Get the instance info
            var componentInstanceInfo = getComponentInstanceInfo(componentRoot);

            // Check the component type to make sure it isnt a collection component
            if (componentInstanceInfo.type != 'collection' && componentInstanceInfo.type != 'conditional')
            {
                // Find the component description
                var component = this.components().find(matchComponentName.bind(undefined, componentInstanceInfo.component));
                if (component)
                {
                    var viewModel = buildComponent(componentRoot, component);

                    // Add the view model to the list of view models that were processed
                    viewModels.push(viewModel);

                    // Find any child data-component nodes and push them onto the queue
                    var childComponents = findChildComponents(componentRoot);
                    childComponents.forEach(enqueueComponent);
                }
            }
        }

        return viewModels;
    }
    var expandComponents = _expandComponents.bind(application);

    var addedNodes = [];

    // Dom node removal observer, used to clean up viewmodels when their views are removed and auto-activate dynamically loaded components
    var domObserver = new MutationObserver(function (mutations)
    {
        // Clean up removed collection components
        mutations.filter(function (mutation) { return mutation.removedNodes.length > 0; }) // Remove any mutation events that arent removals
        .map(function (m) { return m.removedNodes; }) // Operate only on the lists of removed nodes
        .map(function (nodeList) { return $.makeArray(nodeList); }) // Turn the nodelists into a real array
        .flatten() // Flatten the removals into one array of data to prevent nested pipelines
        .filter(function (node) // Remove any DOM events not referring to component nodes
        {
            return $(node).data('component') || application.components().map(function (c) { return c.name; }).indexOf($(node).prop('tagName')) !== -1;
        })
        .forEach(function (node) // Finally, process each component node
        {
            // Get the unique id of the component
            var uid = $(node).attr('id');

            // Find the viewmodel
            var viewModel = application.find(uid);

            // If no viewmodel was found, its parent was removed already, this can be ignored
            if (viewModel)
            {
                // Get the parent and field name
                var instanceInfo = getComponentInstanceInfo($(node));
                var fieldName = instanceInfo.name;
                var parent = viewModel.parent();

                // Collection nodes need extra processing
                if (instanceInfo.type == 'collection')
                {
                    // Remove the viewmodel from the collection in the parent
                    parent[fieldName]().remove(viewModel);
                }
                else
                {
                    // Non collection components can have their property removed from the parent
                    delete parent[fieldName];
                }

                // Trigger removal events
                viewModel.removed.trigger();
                parent.childRemoved.trigger(viewModel);
            }
        });

        // Auto-activate dynamically added components
        mutations.filter(function (mutation) { return mutation.addedNodes.length > 0; }) // Remove any events that are not adds
        .map(function (m) { return m.addedNodes; }) // Operate only on the addedNodes list
        .map(function (nodeList) { return $.makeArray(nodeList); }) // Turn them into a real array
        .flatten() // Flatten
        .filter(function (node) // Remove DOM events for non components
        {
            return $(node).data('component') || application.components().map(function (c) { return c.name; }).indexOf($(node).prop('tagName')) !== -1;
        })
        .forEach(function (node) // Process
        {
            // Get the unique ID
            var uid = $(node).attr('id');

            // See if the node was dynamically added
            if(addedNodes.indexOf(uid) !== -1)
            {
                // If it was, find its component
                var viewModel = application.find(uid);

                // Check to see if it needs activation
                if(viewModel.parent().active())
                {
                    var cii = getComponentInstanceInfo($(node));
                    if(!viewModel.active() && viewModel.view && cii.activate !== undefined)
                    {
                        if(viewModel.uid in activationParameters)
                        {
                            viewModel.activate(activationParameters[viewModel.uid]);
                        }
                        else
                        {
                            viewModel.activate();
                        }
                    }
                }

                // Remove it from the dynamically added nodes list
                addedNodes.splice(addedNodes.indexOf(uid), 1);
            }
        });
    });

    // prepare a viewmodel for child collection components
    function _prepareCollections(childCollections, viewModel)
    {
        childCollections.forEach(function (collection)
        {
            // Get the name of the collection
            var colInstanceInfo = getComponentInstanceInfo($(collection));
            var collectionName = colInstanceInfo.name;

            // Get the component that will be kept in the collection
            var componentName = colInstanceInfo.component;
            var component = this.components().find(function (c) { return c.name == componentName; });

            // Create the prototype for the viewmodel
            var viewModelProto = new application.ViewModel();
            var componentCopy = $.extend(true, {}, component);
            componentCopy.viewModel.prototype = viewModelProto;

            // Create the collection
            var collectionType = componentCopy.viewModel;
            var vmc = new application.ViewModelCollection(collectionType);
            viewModel[collectionName] = ko.observable(vmc);
        }, this);
    }
    var prepareCollections = _prepareCollections.bind(application);

    function _buildComponent(componentRoot, component, type)
    {
        /*jshint validthis:true */

        var instanceInfo = getComponentInstanceInfo(componentRoot);

        // Get the name to use as a field name
        var fieldName = instanceInfo.name;

        // Create the view model and add standard fields
        var viewModelProto = new application.ViewModel();
        var componentCopy = $.extend(true, {}, component);
        componentCopy.viewModel.prototype = viewModelProto;
        var viewModel = new componentCopy.viewModel();

        // Find the parent of the view, using app when there is no parent
        var parentRoot = componentRoot.parent().closest('[data-component]');
        var parent = this;
        if (parentRoot.length > 0)
        {
            parent = this.find(parentRoot.attr('id'));
        }
        else
        {
            var parentRoot = componentRoot.parent().closest(this.components().map(function (c) { return c.name; }).join(','));

            if(parentRoot.length > 0)
                parent = this.find(parentRoot.attr('id'));
        }

        // Add the viewmodel to its parent and add a parent property to the viewmodel
        viewModel.parent(parent);

        var dbString = '';
        if (type != 'collection')
        {
            // Add component property to parent
            parent[fieldName] = ko.observable(viewModel);

            // Listen for removal events
            domObserver.observe(componentRoot.parent().get(0), { childList: true });

            // Add databinding for visibility and context to the component root node
            dbString = 'visible: ' + fieldName + '().visible, with: ' + fieldName;

            if(componentRoot.attr('data-bind') !== undefined)
                dbString += ', ' + componentRoot.attr('data-bind');

            componentRoot.attr('data-bind', dbString);
        }
        else
        {
            // Add the component to the collection property
            parent[fieldName]().add(viewModel);

            // Listen for removal events
            domObserver.observe(componentRoot.parent().get(0), { childList: true });

            // Add databinding for visibility and context to the component root node
            dbString = 'visible: $parent.' + fieldName + '()["' + viewModel.uid + '"]().visible, with: $parent.' + fieldName + '()["' + viewModel.uid + '"]';

            if(componentRoot.attr('data-bind') !== undefined)
                dbString += ', ' + componentRoot.attr('data-bind');

            componentRoot.attr('data-bind', dbString);
        }

        componentRoot.attr('id', viewModel.uid);
        componentRoot.hide();   // Hide by default so that the views don't flash on the screen before knockout kicks in

        // Insert the view into the DOM
        componentRoot.html(component.template);

        // Type any child components
        typeComponents(componentRoot);

        // Get any child collection components and add fields for them so that collection-wide event handlers can be attached
        var childCollections = componentRoot.find('[data-component-type="collection"]').toArray();
        prepareCollections(childCollections, viewModel);

        return viewModel;
    }
    var buildComponent = _buildComponent.bind(application);

    function typeComponents(root)
    {
        // Data component selectors
        // Select foreach data-binds and mark components inside as having type "collection"
        var collectionComponents = root.find('[data-bind*="foreach:"] [data-component]');
        collectionComponents.attr('data-component-type', 'collection');

        // Select if and ifnot data-binds and mark components inside as having type "conditional"
        var conditionalComponents = root.find('[data-bind*="if:"] [data-component],[data-bind*="ifnot:"] [data-component]');
        conditionalComponents.attr('data-component-type', 'conditional');

        // Custom element selectors
        // foreach for collection components
        var collectionComponentsCE = application.components()
            .map(function (c) { return c.name; })
            .reduce(function (aggregate, currentCE)
            {
                return aggregate.add('[data-bind*="foreach:"] ' + currentCE);
            }, $(false));
        collectionComponentsCE.attr('data-component-type', 'collection');

        // if/ifnot for conditional components
        var conditionalComponentsCE = application.components()
            .map(function (c) { return c.name; })
            .reduce(function (aggregate, currentCE)
            {
                return aggregate.add('[data-bind*="if:"] ' + currentCE + ',[data-bind*="ifnot:"] '  + currentCE);
            }, $(false));
        conditionalComponentsCE.attr('data-component-type', 'collection');
    }

    // Updates the title element when the application name is set
    application.name.subscribe(function (value)
    {
        var titleElem = $('title');
        if (titleElem.length > 0)
        {
            titleElem.text(value);
        }
        else
        {
            titleElem = $('<title>' + value + '</title>');
            $('head').append(titleElem);
        }
    });

    // Add node processor for foreach bindings
    ko.bindingProvider.instance.preprocessNode = function (node)
    {
        if(isComponentRoot($(node)))
        {
            var instanceInfo = getComponentInstanceInfo($(node));

            var componentType = instanceInfo.type;
            var componentName = instanceInfo.component;

            if (componentType)
            {
                // Find the component description
                var component = application.components().find(function (c) { return  c.name == componentName; });
                if (component)
                {
                    var viewModel = buildComponent($(node), component, componentType);

                    var childComponents = findChildComponents(viewModel.view());
                    var expandedModels = expandComponents(childComponents);

                    // trigger loaded event from bottom up
                    expandedModels.reverse();
                    expandedModels.forEach(function (comp) { comp.loaded.trigger(); });

                    viewModel.loaded.trigger();

                    // Add to the list of dynamically added nodes
                    addedNodes.push(viewModel.uid);
                }
            }
        }
    };

    return application;
});
