// Application class
// Requries a datamodel in the "Model" module
// Manages switching ui components which are views and associated viewmodels
// Views are HTML partial pages, ViewModels are the underlying databindings and behavior
// of the View. The ViewModel should take and return data to the Model object.
define(['knockout', 'underscore', 'jquery'],
function (ko, _, $)
{
    // Add the guard and sentinel handlers
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

    var ActivationParameters = {};
    ko.bindingHandlers.activate = {
        update: function(element, valueAccessor, allBindings, viewModel, bindingContext)
        {
            var guid = $(element).prop('id');

            var value = valueAccessor();
            var activationParameter = ko.unwrap(value);

            ActivationParameters[guid] = activationParameter;
        }
    };

    // Page Composition Algorithm:
    // -----------------------------------
    // 1. Find all data-component nodes and insert into queue (processing the DOM breadth-first)
    // 2. Take a node off the queue, parse the nodes parameters if any
    // 3. Add events and fields to the node and loaded component
    // 4. Find the components parent, use Application if none, and add variable containers for that component
    // 5. Add visibility and context databindings to the root node
    // 6. Insert the expanded template into the components root as html
    // 7. Parse the components html children for data-component nodes and add them to the queue
    // 8. When the queue is empty, the page is finished loading

    // Application public interface
    var Application = {

        Guid: {
            NewGuid: function ()
            {
                return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c)
                {
                    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
                    return v.toString(16);
                });
            }
        },

        Model: ko.observable({}),

        Name: ko.observable(''),

        Components: ko.observableArray([]),

        Visible: ko.observable(true),

        Children: function ()
        {
            // Grab direct children
            var children = _.chain(this)
                            .filter(ko.isObservable)
                            .filter(function (obs)
                            {
                                return obs() instanceof Application.ViewModel;
                            })
                            .map(function (vm)
                            {
                                return vm();
                            })
                            .value();

            // Grab children in collections
            var collectionChildren = _.chain(this)
                                      .filter(function (prop) { return prop instanceof Application.ViewModelCollection; })
                                      .map(function (vmc) { return vmc.ViewModels(); })
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
        Compose: function (components)
        {
            $('body').attr('data-bind', 'visible: Visible');

            if(!components)
            {
                $.ajaxSetup({ async: false });
                $.getJSON('Components.json', function (c) { components = c; });
                $.ajaxSetup({ async: true });
            }

            this.Components(components);
            LoadComponents(_.bind(function()
            {
                // Apply initial component types
                TypeComponents($('body'));

                var topLevelComponents = $('[data-component]').toArray();
                var expandedModels = ExpandComponents(topLevelComponents);

                // trigger loaded event from bottom up
                expandedModels.reverse();
                _(expandedModels).each(function (comp) { comp.Loaded.Trigger(); });

                // Apply databindings
                ko.applyBindings(this);

                // Trigger that the application as a whole is loaded
                this.Loaded.Trigger();

                // Activate any immediate children that are set to auto-activate
                _(this.Children()).each(function (vm)
                {
                    if(!vm.Active() && vm.View && vm.View().data('activate') !== undefined)
                    {
                        if(vm.Uid in ActivationParameters)
                        {
                            vm.Activate(ActivationParameters[vm.Uid]);
                        }
                        else
                        {
                            vm.Activate();
                        }
                    }
                });

            }, this));
        },

        // Find an component by id using a depth first search (recursive)
        Find: function (componentId)
        {
            var target = null;

            _(this.Children()).each(function (child)
            {
                var foundChild = null;
                if (child.Uid == componentId)
                {
                    foundChild = child;
                }
                else
                {
                    foundChild = child.Find(componentId);
                }

                if (foundChild != null)
                {
                    target = foundChild;
                }
            });

            return target;
        },

        // Inject a component dynamically
        InjectComponent: function (component)
        {
            // Expand the component into the DOM
            var viewModels = ExpandComponent(component);
            viewModels.reverse();

            // Trigger loaded handlers from the bottom up
            _(viewModels).each(function (vm) { vm.Loaded.Trigger(); });

            // Apply bindings to the root level injected node using its parent
            var parent = _(viewModels).last().Parent();
            ko.applyBindingsToNode(component, null, parent);

            // Return the root of the injected componentsQueue
            return _(viewModels).last();
        },

        // Event prototype
        Event: function ()
        {
            // Generate a unique id if one was not provided
            this.Id = Application.Guid.NewGuid();

            // Attaches an event handler
            this.On = _.bind(function ()
            {
                var args = $.makeArray(arguments);

                return $(this).on.apply($(this), [this.Id].concat(args));
            }, this);

            // Detaches an event handler
            this.Off = _.bind(function ()
            {
                var args = $.makeArray(arguments);

                return $(this).off.apply($(this), [this.Id].concat(args));
            }, this);

            // Triggers the event
            this.Trigger = _.bind(function ()
            {
                return $(this).triggerHandler(this.Id, arguments);
            }, this);
        },

        RoutedEvent: function ()
        {
            // Track the routed signal using a private event that can only be triggered internally
            var event = new Application.Event();

            // Triggers the routed events
            var triggerRoute = _.bind(function ()
            {
                var argsWithoutEvent = $.makeArray(arguments).slice(1);
                event.Trigger.apply(this, argsWithoutEvent);
            }, this);

            // Adds an event whose signal will be routed
            this.AddRoute = _.bind(function (ev)
            {
                ev.On(triggerRoute);
            }, this);

            // Removes an event from routing
            this.RemoveRoute = _.bind(function (ev)
            {
                ev.Off(triggerRoute);
            }, this);

            // Allow turning on and off subscriptions to the routed signals
            this.On = event.On;
            this.Off = event.Off;
        },

        // Viewmodel prototype parent
        ViewModel: function ()
        {
            // Observable property controls visibility
            this.Visible = ko.observable(false);

            // Parent, children, and find child function
            this.Parent = ko.observable({});
            this.Children = Application.Children;
            this.Find = Application.Find;

            // Loaded event, fired after the components view is added and its viewmodel is set up
            this.Loaded = new Application.Event();

            // Tracks if a component is active, not settable
            var isActive = false;
            this.Active = function () { return isActive; } // Tracks if the component is active

            // Activates the component, any number of arguments can be passed to the activation handlers
            this.Activate = function ()
            {
                this.Visible(true);
                isActive = true;

                if (this.View && this.View().data('componentType') == 'collection')
                {
                    var data = ko.dataFor(this.View().get(0));

                    var args = $.makeArray(arguments);

                    var params = args.concat(data);
                    this.Activated.Trigger.apply(this.Activated, params);
                }
                else
                {
                    this.Activated.Trigger.apply(this.Activated, arguments);
                }

                _(this.Children()).each(function (vm)
                {
                    if(!vm.Active() && vm.View && vm.View().data('activate') !== undefined)
                    {
                        if(vm.Uid in ActivationParameters)
                        {
                            vm.Activate(ActivationParameters[vm.Uid]);
                        }
                        else
                        {
                            vm.Activate();
                        }
                    }
                });
            };
            this.Activated = new Application.Event(); // Activated event

            // Finishes the component, any number of arguments can be passed to the finish handlers
            this.Finish = function ()
            {
                this.Visible(false);
                isActive = false;
                this.Finished.Trigger.apply(this.Finished, arguments);

            	_(this.Children()).each(function (vm)
            	{
        			if(vm.Active())
            			vm.Finish();
            	});
            };
            this.Finished = new Application.Event(); // Finish event

            // Unique identifier
            this.Uid = Application.Guid.NewGuid();

            // Gets the root of the components view
            this.View = _.bind(function () { return $('#' + this.Uid); }, this);

            // Removes the component's view which triggers removal of the entire component
            this.Remove = _.bind(function () { this.View().remove(); }, this);
            this.Removed = new Application.Event(); // Removed event
            this.ChildRemoved = new Application.Event(); // Child removed event

            function filterProperties(filterFunction)
            {
                return _.chain(this)
                        .map(function (prop, key)
                        {
                            return { Name: key, Property: prop };
                        })
                        .filter(filterFunction)
                        .value();
            }

            // Gets any events attached to the viewmodel
            this.Events = function ()
            {
                return filterProperties.apply(this, [function (desc)
                        {
                            return desc.Property instanceof Application.Event;
                        }]);
            };

            // Get functions of the viewmodel
            this.Functions = function ()
            {
                return filterProperties.apply(this, [function (desc)
                        {
                            return typeof(desc.Property) == 'function' && !ko.isObservable(desc.Property);
                        }]);
            };

            this.Observables = function ()
            {
                return filterProperties.apply(this, [function (desc)
                {
                    return ko.isObservable(desc.Property);
                }]);
            };

            // Get non-function, non-event proprties of the viewmodel
            this.Properties = function ()
            {
                return filterProperties.apply(this, [function (desc)
                {
                    return typeof(desc.Property) != 'function' && !(desc.Property instanceof Application.Event);
                }]);
            };
        },

        // Manages a collection of viewmodels
        ViewModelCollection: function (collectionType)
        {
            // Get a prototype of the components this collection will manage
            var collectionPrototype = new collectionType();

            // Create routed events for any of the user defined events so that handlers can be attached collection-wide
            var events = collectionPrototype.Events();
            _(events).each(function (ev)
            {
                this[ev.Name] = new Application.RoutedEvent();
            }, this);

            // Create functions that can be called collection wide
            var functions = collectionPrototype.Functions();
            _(functions).each(function (f)
            {
                this[f.Name] = function ()
                {
                    var args = _.toArray(arguments);
                    var returns = [];
                    _(this.ViewModels()).each(function (vm)
                    {
                        var ret = vm()[f.Name].apply(vm(), args);
                        returns.push(ret);
                    });

                    return returns;
                };
            }, this);

            // Create observables that can be get/set collection wide
            var observables = collectionPrototype.Observables();
            _(observables).each(function (o)
            {
                this[o.Name] = function (val)
                {
                    if(val)
                    {
                        _(this.ViewModels()).each(function (vm)
                        {
                            vm()[o.Name](val);
                        });
                    }
                    else
                    {
                        var vals = [];
                        _(this.ViewModels()).each(function (vm)
                        {
                            vals.push(vm()[o.Name]());
                        });

                        return vals;
                    }
                };
            }, this);

            // Create properties that can be get/set collection wide
            var properties = collectionPrototype.Properties();
            var addedProperties = [];
            _(properties).each(function (p)
            {
                var vmc = this;

                Object.defineProperty(this, p.Name, {
                    enumerable: true,
                    get: function ()
                    {
                        var vals = [];
                        _(vmc.ViewModels()).each(function (vm)
                        {
                            vals.push(vm()[p.Name]);
                        });

                        return vals;
                    },

                    set: function (val)
                    {
                        _(vmc.ViewModels()).each(function (vm)
                        {
                            vm()[p.Name] = val;
                        });
                    }
                });

                addedProperties.push(p.Name);

            }, this);

            // Gets the viewmodels in the collection
            this.ViewModels = function ()
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
                            return prop() instanceof Application.ViewModel;
                        })
                        .value();
            };

            // Activate all viewmodels in the collection
            this.Activate = _.bind(function ()
            {
                var args = arguments;

                _(this.ViewModels()).each(function (vm)
                {
                    vm().Activate.apply(vm(), args);
                });
            }, this);
            this.Activated = new Application.RoutedEvent();

            // Finish all viewmodels in the collection
            this.Finish = _.bind(function ()
            {
                var args = arguments;

                _(this.ViewModels()).each(function (vm)
                {
                    vm().Finish.apply(vm(), args);
                });
            }, this);
            this.Finished = new Application.RoutedEvent();

            // Add a viewmodel to the collection
            this.Add = _.bind(function (vm)
            {
                // Route user events
                _(vm.Events()).each(function (ev)
                {
                    if (ev.Name in this)
                    {
                        this[ev.Name].AddRoute(ev.Property);
                    }
                }, this);

                // Route standard events
                this.Loaded.AddRoute(vm.Loaded);
                this.Activated.AddRoute(vm.Activated);
                this.Finished.AddRoute(vm.Finished);
                this.Removed.AddRoute(vm.Removed);
                this.ChildRemoved.AddRoute(vm.ChildRemoved);

                // Add to the collection
                this[vm.Uid] = ko.observable(vm);

            }, this);
            this.Loaded = new Application.RoutedEvent();

            // Remove a viewmodel from the collection
            this.Remove = _.bind(function (vm)
            {
                // Make sure the component is in the collection
                if (vm.Uid in this)
                {
                    // Remove the component
                    delete this[vm.Uid];

                    // Remove routing for standard event handlers
                    this.Loaded.RemoveRoute(vm.Loaded);
                    this.Activated.RemoveRoute(vm.Activated);
                    this.Finished.RemoveRoute(vm.Finished);
                    this.Removed.RemoveRoute(vm.Removed);
                    this.ChildRemoved.RemoveRoute(vm.ChildRemoved);

                    // Remove routing for user events
                    _(vm.Events()).each(function (ev)
                    {
                        if (ev.Name in this)
                        {
                            this[ev.Name].RemoveRoute(ev.Property);
                        }
                    }, this);
                }
            }, this);
            this.Removed = new Application.RoutedEvent();
            this.ChildRemoved = new Application.RoutedEvent();
        }
    }

    // Application events
    Application.Loaded = new Application.Event();   // Triggered when the application is finished loading

    Application.ChildRemoved = new Application.Event(); // Triggered when a direct child of Application is removed

    // Application private interface

    // Parses a javascript object from a string, NOT json
    function ParseJsObject(string)
    {
        // Use 'eval' to create a javascript object from the malformed JSON
        // NOTE: there are some security concerns with this method
        var parenString = '(' + string + ')'; // object literals must be enclosed in parenthesis for eval to work properly
        var obj = eval(parenString);

        return obj;
    }

    // Loads view templates and styles for each component
    function _LoadComponents(callback)
    {
        // Put JQuery AJAX into synchronous mode for this algorithm to work, we will clear this flag once page loading is complete
        $.ajaxSetup({ async: false });

        var viewmodelPaths = [];
        var viewmodelIdx = [];

        // Preload styles and templates for each component
        _(this.Components()).each(function (comp, i)
        {
            // Append the style node to the pages head
            if ('Style' in comp)
            {
                var styleLink = $('<link rel="stylesheet" type="text/css" href="' + comp.Style + '"/>');
                $('head').append(styleLink);
            }

            // Load the view template and store it for later
            $.get(comp.View, {}, function (viewData)
            {
                comp.Template = viewData;
            });

            if(typeof comp.ViewModel == 'string')
            {
                viewmodelPaths.push(comp.ViewModel);
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
                    this.Components()[viewmodelIdx[i]].ViewModel = arguments[i];
                }

                callback();
            }, this));
        }
        else
        {
            callback();
        }
    }
    var LoadComponents = _.bind(_LoadComponents, Application);

    // Shorthand to expand a single component
    // returns a tree structure in an array of the expanded components
    function _ExpandComponent(component)
    {
        return ExpandComponents([component]);
    }
    var ExpandComponent = _.bind(_ExpandComponent, Application);

    // Expands a data-component element into its component, uses a breadth-first traversal
    // Returns a list of the constructed view models that were expanded
    function _ExpandComponents(components)
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
                var component = _(this.Components()).findWhere({ Name: componentName });
                if (component)
                {
                    var viewModel = BuildComponent(componentRoot, component);

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
    var ExpandComponents = _.bind(_ExpandComponents, Application);

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
            var viewModel = Application.Find(uid);

            // If no viewmodel was found, its parent was removed already, this can be ignored
            if (viewModel)
            {
                // Get the parent and field name
                var fieldName = $(node).data('name');
                var parent = viewModel.Parent();

                // Collection nodes need extra processing
                if ($(node).data('componentType') == 'collection')
                {
                    // Remove the viewmodel from the collection in the parent
                    parent[fieldName].Remove(viewModel);
                }
                else
                {
                    // Non collection components can have their property removed from the parent
                    delete parent[fieldName];
                }

                // Trigger removal events
                viewModel.Removed.Trigger();
                parent.ChildRemoved.Trigger(viewModel);
            }
        });
    });

    function _BuildComponent(componentRoot, component, type)
    {
        // Get the components view parameters
        var params = componentRoot.data('parameters');
        if (params)
        {
            params = ParseJsObject(params);
        }

        // Get the name to use as a field name
        var fieldName = componentRoot.data('name');

        // Create the view model and add standard fields
        var viewModelProto = new Application.ViewModel();
        var componentCopy = $.extend(true, {}, component);
        componentCopy.ViewModel.prototype = viewModelProto;
        var viewModel = new componentCopy.ViewModel();

        // Find the parent of the view, using app when there is no parent
        var parentRoot = componentRoot.parent().closest('[data-component]');
        var parent = this;
        if (parentRoot.length > 0)
        {
            var parent = this.Find(parentRoot.attr('id'));
        }

        // Add the viewmodel to its parent and add a parent property to the viewmodel
        viewModel.Parent(parent);

        if (type != 'collection')
        {
            // Add component property to parent
            parent[fieldName] = ko.observable(viewModel);

            // Listen for removal events
            domObserver.observe(componentRoot.parent().get(0), { childList: true });

            // Add databinding for visibility and context to the component root node
            var dbString = 'visible: ' + fieldName + '().Visible, with: ' + fieldName;

            if(componentRoot.attr('data-bind') !== undefined)
                dbString += ', ' + componentRoot.attr('data-bind');

            componentRoot.attr('data-bind', dbString);
        }
        else
        {
            // Add the component to the collection property
            parent[fieldName].Add(viewModel);

            // Listen for removal events
            domObserver.observe(componentRoot.parent().get(0), { childList: true });

            // Add databinding for visibility and context to the component root node
            var dbString = 'visible: $parent.' + fieldName + '["' + viewModel.Uid + '"]().Visible, with: $parent.' + fieldName + '["' + viewModel.Uid + '"]';

            if(componentRoot.attr('data-bind') !== undefined)
                dbString += ', ' + componentRoot.attr('data-bind');

            componentRoot.attr('data-bind', dbString);
        }

        componentRoot.attr('id', viewModel.Uid);
        componentRoot.hide();   // Hide by default so that the views don't flash on the screen before knockout kicks in

        // Compile the view using its parameters
        var compiledView = _.template(component.Template, params);

        // Insert the compiled view into the DOM
        componentRoot.html(compiledView);

        // Type any child components
        TypeComponents(componentRoot);

        // Get any child collection components and add fields for them so that collection-wide event handlers can be attached
        var childCollections = componentRoot.find('[data-component-type="collection"]');
        _(childCollections).each(function (collection)
        {
            // Get the name of the collection
            var collectionName = $(collection).data('name');

            // Get the component that will be kept in the collection
            var componentName = $(collection).data('component');
            var component = _(this.Components()).findWhere({ Name: componentName });

            // Create the prototype for the viewmodel
            var viewModelProto = new Application.ViewModel();
            var componentCopy = $.extend(true, {}, component);
            componentCopy.ViewModel.prototype = viewModelProto;

            // Create the collection
            var collectionType = componentCopy.ViewModel;
            viewModel[collectionName] = new Application.ViewModelCollection(collectionType);
        }, this);

        return viewModel;
    }
    var BuildComponent = _.bind(_BuildComponent, Application);

    function TypeComponents(root)
    {
        // Select foreach data-binds and mark components inside as having type "collection"
        var collectionComponents = root.find('[data-bind*="foreach:"] [data-component]');
        collectionComponents.attr('data-component-type', 'collection');

        // Select if and ifnot data-binds and mark components inside as having type "conditional"
        var conditionalComponents = root.find('[data-bind*="if:"] [data-component],[data-bind*="ifnot:"] [data-component]');
        conditionalComponents.attr('data-component-type', 'conditional');
    }

    // Updates the title element when the application name is set
    Application.Name.subscribe(function (value)
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
            var component = _(Application.Components()).findWhere({ Name: componentName });
            if (component)
            {
                var viewModel = BuildComponent($(node), component, componentType);

                var childComponents = viewModel.View().find('[data-component]').toArray();
                var expandedModels = ExpandComponents(childComponents);

                // trigger loaded event from bottom up
                expandedModels.reverse();
                _(expandedModels).each(function (comp) { comp.Loaded.Trigger(); });

                viewModel.Loaded.Trigger();
            }
        }
    };

    return Application;
});
