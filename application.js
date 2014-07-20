define(['knockout', 'underscore', 'jquery'],
function (ko, _, $)
{
    // Add the guard and sentinel binding handlers
    ko.bindingHandlers.guard = {
        init: function(element, valueAccessor, allBindings, viewModel, bindingContext)
        {
            var redirect = ko.observable();
            var fallback = {};

            if(allBindings.has('default'))
                fallback = allBindings.get('default');

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
            var children = _.chain(this)
                            .filter(ko.isObservable)
                            .filter(function (obs)
                            {
                                return obs() instanceof application.ViewModel;
                            })
                            .map(function (vm)
                            {
                                return vm();
                            })
                            .value();

            // Grab children in collections
            var collectionChildren = _.chain(this)
                                      .filter(function (prop) { return prop instanceof application.ViewModelCollection; })
                                      .map(function (vmc) { return vmc.viewModels(); })
                                      .flatten()
                                      .map(function (vm)
                                      {
                                          return vm();
                                      })
                                      .value();

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
                $.getJSON('components.json', function (c) { components = c; });
                $.ajaxSetup({ async: true });
            }

            this.components(components);
            loadComponents(_.bind(function()
            {
                // Apply initial component types
                typeComponents($('body'));

                var topLevelComponents = $('[data-component]').toArray();
                var expandedModels = expandComponents(topLevelComponents);

                // trigger loaded event from bottom up
                expandedModels.reverse();
                _(expandedModels).each(function (comp) { comp.loaded.trigger(); });

                // Apply databindings
                ko.applyBindings(this);

                // Trigger that the application as a whole is loaded
                this.loaded.trigger();

                // Activate any immediate children that are set to auto-activate
                _(this.children()).each(function (vm)
                {
                    if(!vm.active() && vm.view && vm.view().data('activate') !== undefined)
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

            }, this));
        },

        // Find an component by id using a depth first search (recursive)
        find: function (componentId)
        {
            var target = null;

            _(this.children()).each(function (child)
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

                if (foundChild != null)
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
            _(viewModels).each(function (vm) { vm.loaded.trigger(); });

            // Apply bindings to the root level injected node using its parent
            var parent = _(viewModels).last().parent();
            ko.applyBindingsToNode(component, null, parent);

            // Return the root of the injected componentsQueue
            return _(viewModels).last();
        },

        // Event prototype
        Event: function ()
        {
            // Generate a unique id if one was not provided
            this.id = application.guid.newGuid();

            // Attaches an event handler
            this.on = _.bind(function ()
            {
                var args = $.makeArray(arguments);

                return $(this).on.apply($(this), [this.id].concat(args));
            }, this);

            // Detaches an event handler
            this.off = _.bind(function ()
            {
                var args = $.makeArray(arguments);

                return $(this).off.apply($(this), [this.id].concat(args));
            }, this);

            // Triggers the event
            this.trigger = _.bind(function ()
            {
                return $(this).triggerHandler(this.id, arguments);
            }, this);
        },

        RoutedEvent: function ()
        {
            // Track the routed signal using a private event that can only be triggered internally
            var event = new application.Event();

            // Triggers the routed events
            var triggerRoute = _.bind(function ()
            {
                var argsWithoutEvent = $.makeArray(arguments).slice(1);
                event.trigger.apply(this, argsWithoutEvent);
            }, this);

            // Adds an event whose signal will be routed
            this.addRoute = _.bind(function (ev)
            {
                ev.on(triggerRoute);
            }, this);

            // Removes an event from routing
            this.removeRoute = _.bind(function (ev)
            {
                ev.off(triggerRoute);
            }, this);

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
            this.active = function () { return isActive; } // Tracks if the component is active

            // Activates the component, any number of arguments can be passed to the activation handlers
            this.activate = function ()
            {
                this.visible(true);
                isActive = true;

                if (this.view && this.view().data('componentType') == 'collection')
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

                _(this.children()).each(function (vm)
                {
                    if(!vm.active() && vm.view && vm.view().data('activate') !== undefined)
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
            };
            this.activated = new application.Event(); // Activated event

            // Finishes the component, any number of arguments can be passed to the finish handlers
            this.finish = function ()
            {
                this.visible(false);
                isActive = false;
                this.finished.trigger.apply(this.finished, arguments);

            	_(this.children()).each(function (vm)
            	{
        			if(vm.active())
            			vm.finish();
            	});
            };
            this.finished = new application.Event(); // Finish event

            // Unique identifier
            this.uid = application.guid.newGuid();

            // Gets the root of the components view
            this.view = _.bind(function () { return $('#' + this.uid); }, this);

            // Removes the component's view which triggers removal of the entire component, this will
            // happen automatically (along with triggering of any events) when the DOM observer
            // catches this change
            this.remove = _.bind(function () { this.view().remove(); }, this);
            this.removed = new application.Event(); // Removed event
            this.childRemoved = new application.Event(); // Child removed event

            function filterProperties(filterFunction)
            {
                return _.chain(this)
                        .map(function (prop, key)
                        {
                            return { name: key, property: prop };
                        })
                        .filter(filterFunction)
                        .value();
            }

            // Gets any events attached to the viewmodel
            this.events = function ()
            {
                return filterProperties.apply(this, [function (desc)
                        {
                            return desc.property instanceof application.Event;
                        }]);
            };

            // Get functions of the viewmodel
            this.functions = function ()
            {
                return filterProperties.apply(this, [function (desc)
                        {
                            return typeof(desc.property) == 'function' && !ko.isObservable(desc.property);
                        }]);
            };

            this.observables = function ()
            {
                return filterProperties.apply(this, [function (desc)
                {
                    return ko.isObservable(desc.property);
                }]);
            };

            // Get non-function, non-event proprties of the viewmodel
            this.properties = function ()
            {
                return filterProperties.apply(this, [function (desc)
                {
                    return typeof(desc.property) != 'function' && !(desc.property instanceof application.Event);
                }]);
            };
        },

        // Manages a collection of viewmodels
        ViewModelCollection: function (collectionType)
        {
            // Get a prototype of the components this collection will manage
            var collectionPrototype = new collectionType();

            // Create routed events for any of the user defined events so that handlers can be attached collection-wide
            var events = collectionPrototype.events();
            _(events).each(function (ev)
            {
                this[ev.name] = new application.RoutedEvent();
            }, this);

            // Create functions that can be called collection wide
            var functions = collectionPrototype.functions();
            _(functions).each(function (f)
            {
                this[f.name] = function ()
                {
                    var args = _.toArray(arguments);
                    var returns = [];
                    _(this.viewModels()).each(function (vm)
                    {
                        var ret = vm()[f.name].apply(vm(), args);
                        returns.push(ret);
                    });

                    return returns;
                };
            }, this);

            // Create observables that can be get/set collection wide
            var observables = collectionPrototype.observables();
            _(observables).each(function (o)
            {
                this[o.name] = function (val)
                {
                    if(val)
                    {
                        _(this.viewModels()).each(function (vm)
                        {
                            vm()[o.name](val);
                        });
                    }
                    else
                    {
                        var vals = [];
                        _(this.viewModels()).each(function (vm)
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
            _(properties).each(function (p)
            {
                var vmc = this;

                Object.defineProperty(this, p.name, {
                    enumerable: true,
                    get: function ()
                    {
                        var vals = [];
                        _(vmc.viewModels()).each(function (vm)
                        {
                            vals.push(vm()[p.name]);
                        });

                        return vals;
                    },

                    set: function (val)
                    {
                        _(vmc.viewModels()).each(function (vm)
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

                return _.chain(safeProperties)
                        .map(function (name)
                        {
                            return this[name];
                        }, this)
                        .filter(ko.isObservable)
                        .filter(function (prop)
                        {
                            return prop() instanceof application.ViewModel;
                        })
                        .value();
            };

            // Activate all viewmodels in the collection
            this.activate = _.bind(function ()
            {
                var args = arguments;

                _(this.viewModels()).each(function (vm)
                {
                    vm().activate.apply(vm(), args);
                });
            }, this);
            this.activated = new application.RoutedEvent();

            // Finish all viewmodels in the collection
            this.finish = _.bind(function ()
            {
                var args = arguments;

                _(this.viewModels()).each(function (vm)
                {
                    vm().finish.apply(vm(), args);
                });
            }, this);
            this.finished = new application.RoutedEvent();

            // Add a viewmodel to the collection
            this.add = _.bind(function (vm)
            {
                // Route user events
                _(vm.events()).each(function (ev)
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

            }, this);
            this.loaded = new application.RoutedEvent();

            // Remove a viewmodel from the collection
            this.remove = _.bind(function (vm)
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
                    _(vm.events()).each(function (ev)
                    {
                        if (ev.name in this)
                        {
                            this[ev.name].removeRoute(ev.property);
                        }
                    }, this);
                }
            }, this);
            this.removed = new application.RoutedEvent();
            this.childRemoved = new application.RoutedEvent();
        }
    }

    // Application events
    application.loaded = new application.Event();   // Triggered when the application is finished loading

    application.childRemoved = new application.Event(); // Triggered when a direct child of Application is removed

    // Application private interface

    // Parses a javascript object from a string, NOT json
    function parseJsObject(string)
    {
        // Use 'eval' to create a javascript object from the malformed JSON
        // NOTE: there are some security concerns with this method
        var parenString = '(' + string + ')'; // object literals must be enclosed in parenthesis for eval to work properly
        var obj = eval(parenString);

        return obj;
    }

    // Loads view templates and styles for each component
    function _loadComponents(callback)
    {
        // Put JQuery AJAX into synchronous mode for this algorithm to work, we will clear this flag once page loading is complete
        $.ajaxSetup({ async: false });

        var viewmodelPaths = [];
        var viewmodelIdx = [];

        // Preload styles and templates for each component
        _(this.components()).each(function (comp, i)
        {
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
            require(viewmodelPaths, _.bind(function ()
            {
                for(var i = 0; i < arguments.length; i++)
                {
                    this.components()[viewmodelIdx[i]].viewModel = arguments[i];
                }

                callback();
            }, this));
        }
        else
        {
            callback();
        }
    }
    var loadComponents = _.bind(_loadComponents, application);

    // Shorthand to expand a single component
    // returns a tree structure in an array of the expanded components
    function _expandComponent(component)
    {
        return expandComponents([component]);
    }
    var expandComponent = _.bind(_expandComponent, application);

    // Expands a data-component element into its component, uses a breadth-first traversal
    // Returns a list of the constructed view models that were expanded
    function _expandComponents(components)
    {
        var componentsQueue = components;
        var viewModels = [];

        while (componentsQueue.length > 0)
        {
            var componentRoot = $(componentsQueue.shift()); // dequeue operation
            var componentName = componentRoot.data('component');

            // Check the component type to make sure it isnt a collection component
            var componentType = componentRoot.data('componentType');
            if (componentType != 'collection' && componentType != 'conditional')
            {
                // Find the component description
                var component = _(this.components()).findWhere({ name: componentName });
                if (component)
                {
                    var viewModel = buildComponent(componentRoot, component);

                    // Add the view model to the list of view models that were processed
                    viewModels.push(viewModel);

                    // Find any child data-component nodes and push them onto the queue
                    var childComponents = componentRoot.find('[data-component]').toArray();
                    _(childComponents).each(function (child)
                    {
                        componentsQueue.push(child);
                    });
                }
            }
        }

        return viewModels;
    }
    var expandComponents = _.bind(_expandComponents, application);

    // Dom node removal observer, used to clean up viewmodels when their views are removed
    var domObserver = new MutationObserver(function (mutations)
    {
        // This pipeline is optimized to remove any extra processing
        _.chain(mutations)
        .filter(function (mutation) { return mutation.removedNodes.length > 0; }) // Remove any mutation events that arent removals
        .pluck('removedNodes') // Operate only on the lists of removed nodes
        .map(function (nodeList) { return $.makeArray(nodeList); }) // Turn the nodelists into an array that underscore can manipulate
        .flatten() // Flatten the removals into one array of data to prevent nested pipelines
        .filter(function (node) { return $(node).data('component'); }) // Remove any DOM events not referring to component nodes
        .each(function (node) // Finally, process each component node
        {
            // Get the unique id of the component
            var uid = $(node).attr('id');

            // Find the viewmodel
            var viewModel = application.find(uid);

            // If no viewmodel was found, its parent was removed already, this can be ignored
            if (viewModel)
            {
                // Get the parent and field name
                var fieldName = $(node).data('name');
                var parent = viewModel.parent();

                // Collection nodes need extra processing
                if ($(node).data('componentType') == 'collection')
                {
                    // Remove the viewmodel from the collection in the parent
                    parent[fieldName].remove(viewModel);
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
    });

    function _buildComponent(componentRoot, component, type)
    {
        // Get the components view parameters
        var params = componentRoot.data('parameters');
        if (params)
        {
            params = parseJsObject(params);
        }

        // Get the name to use as a field name
        var fieldName = componentRoot.data('name');

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
            var parent = this.find(parentRoot.attr('id'));
        }

        // Add the viewmodel to its parent and add a parent property to the viewmodel
        viewModel.parent(parent);

        if (type != 'collection')
        {
            // Add component property to parent
            parent[fieldName] = ko.observable(viewModel);

            // Listen for removal events
            domObserver.observe(componentRoot.parent().get(0), { childList: true });

            // Add databinding for visibility and context to the component root node
            var dbString = 'visible: ' + fieldName + '().visible, with: ' + fieldName;

            if(componentRoot.attr('data-bind') !== undefined)
                dbString += ', ' + componentRoot.attr('data-bind');

            componentRoot.attr('data-bind', dbString);
        }
        else
        {
            // Add the component to the collection property
            parent[fieldName].add(viewModel);

            // Listen for removal events
            domObserver.observe(componentRoot.parent().get(0), { childList: true });

            // Add databinding for visibility and context to the component root node
            var dbString = 'visible: $parent.' + fieldName + '["' + viewModel.uid + '"]().visible, with: $parent.' + fieldName + '["' + viewModel.uid + '"]';

            if(componentRoot.attr('data-bind') !== undefined)
                dbString += ', ' + componentRoot.attr('data-bind');

            componentRoot.attr('data-bind', dbString);
        }

        componentRoot.attr('id', viewModel.uid);
        componentRoot.hide();   // Hide by default so that the views don't flash on the screen before knockout kicks in

        // Compile the view using its parameters
        var compiledView = _.template(component.template, params);

        // Insert the compiled view into the DOM
        componentRoot.html(compiledView);

        // Type any child components
        typeComponents(componentRoot);

        // Get any child collection components and add fields for them so that collection-wide event handlers can be attached
        var childCollections = componentRoot.find('[data-component-type="collection"]');
        _(childCollections).each(function (collection)
        {
            // Get the name of the collection
            var collectionName = $(collection).data('name');

            // Get the component that will be kept in the collection
            var componentName = $(collection).data('component');
            var component = _(this.components()).findWhere({ name: componentName });

            // Create the prototype for the viewmodel
            var viewModelProto = new application.ViewModel();
            var componentCopy = $.extend(true, {}, component);
            componentCopy.viewModel.prototype = viewModelProto;

            // Create the collection
            var collectionType = componentCopy.viewModel;
            viewModel[collectionName] = new application.ViewModelCollection(collectionType);
        }, this);

        return viewModel;
    }
    var buildComponent = _.bind(_buildComponent, application);

    function typeComponents(root)
    {
        // Select foreach data-binds and mark components inside as having type "collection"
        var collectionComponents = root.find('[data-bind*="foreach:"] [data-component]');
        collectionComponents.attr('data-component-type', 'collection');

        // Select if and ifnot data-binds and mark components inside as having type "conditional"
        var conditionalComponents = root.find('[data-bind*="if:"] [data-component],[data-bind*="ifnot:"] [data-component]');
        conditionalComponents.attr('data-component-type', 'conditional');
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
        var componentType = $(node).data('componentType');
        var componentName = $(node).data('component');

        if (componentType)
        {
            // Find the component description
            var component = _(application.components()).findWhere({ name: componentName });
            if (component)
            {
                var viewModel = buildComponent($(node), component, componentType);

                var childComponents = viewModel.view().find('[data-component]').toArray();
                var expandedModels = expandComponents(childComponents);

                // trigger loaded event from bottom up
                expandedModels.reverse();
                _(expandedModels).each(function (comp) { comp.loaded.trigger(); });

                viewModel.loaded.trigger();
            }
        }
    };

    return application;
});
