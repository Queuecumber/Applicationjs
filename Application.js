// Application class
// Requries a datamodel in the "Model" module
// Manages switching ui components which are views and associated viewmodels
// Views are HTML partial pages, ViewModels are the underlying databindings and behavior
// of the View. The ViewModel should take and return data to the Model object.
define(['knockout', 'underscore', 'jquery', 'guid'],
function (ko, _, $, Guid)
{
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

        Model: ko.observable({}),

        Name: ko.observable(''),

        Components: ko.observableArray([]),

        Visible: ko.observable(true),

        Children: ko.observableArray(),

        // Composes the page and applies data bindings
        Compose: function (components)
        {
            this.Components(components);
            LoadComponents();

            // Apply initial component types
            TypeComponents($('body'));

            var topLevelComponents = $('[data-component]').toArray();
            var expandedModels = ExpandComponents(topLevelComponents);

            // trigger loaded event from bottom up
            expandedModels.reverse();
            _(expandedModels).each(function (comp) { $(comp).triggerHandler('Loaded'); });

            // Finally trigger that the application as a whole is loaded
            $(this).triggerHandler('Loaded');

            ko.applyBindings(this);
        },

        // Activate a component, attached to all child components ViewModels
        Activate: function ()
        {
            this.Visible(true);

            if (this.View && this.View().data('componentType') == 'collection')
            {
                var data = ko.dataFor(this.View().get(0));

                var params = [data].concat(arguments);
                $(this).triggerHandler('Activate', params);
            }
            else
            {
                $(this).triggerHandler('Activate', arguments);
            }
        },

        // Finishes a component, attached to all child components ViewModels
        Finish: function ()
        {
            this.Visible(false);
            $(this).triggerHandler('Finish', arguments);
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
            _(viewModels).each(function (vm) { $(vm).triggerHandler('Loaded'); });

            // Apply bindings to the root level injected node using its parent
            var parent = _(viewModels).last().Parent();
            ko.applyBindingsToNode(component, null, parent);

            // Return the root of the injected componentsQueue
            return _(viewModels).last();
        }
    }

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
    function _LoadComponents()
    {
        // Put JQuery AJAX into synchronous mode for this algorithm to work, we will clear this flag once page loading is complete
        $.ajaxSetup({ async: false });

        // Preload styles and templates for each component
        _(this.Components()).each(function (comp)
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
        });

        // Put JQuery back into asynchronous mode for future ajax requests
        $.ajaxSetup({ async: true });
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
            if (componentType != 'collection')
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
        var viewModel = new component.ViewModel();
        viewModel.Visible = ko.observable(false); // Hidden by default
        viewModel.Name = fieldName;
        viewModel.ViewParameters = params;
        viewModel.Children = ko.observableArray();
        viewModel.Find = this.Find;
        viewModel.Activate = this.Activate;
        viewModel.Finish = this.Finish;
        viewModel.Uid = Guid.NewGuid();
        viewModel.View = function () { return $('#' + this.Uid); };
        viewModel.Remove = function() { this.View.remove(); };

        // Find the parent of the view, using app when there is no parent
        var parentRoot = componentRoot.parent().closest('[data-component]');
        var parent = this;
        if (parentRoot.length > 0)
        {
            var parent = this.Find(parentRoot.attr('id'));
        }

        // Add the viewmodel to its parent and add a parent property to the viewmodel
        parent.Children.push(viewModel);
        viewModel.Parent = ko.observable(parent);
        
        if (type != 'collection')
        {
            parent[fieldName] = ko.observable(viewModel);

            // Add remove handler to clean up viewmodel when removed from parent
            viewModel.View.on('DOMNodeRemoved', function ()
            {
                delete parent[fieldName];
                
                var childIndex = parent.Children.indexOf(viewModel);
                if(childIndex > -1)
                {
                    parent.Children.splice(childIndex, 1);
                }
            });

            // Add databinding for visibility and context to the component root node
            componentRoot.attr('data-bind', 'visible: ' + fieldName + '().Visible, with: ' + fieldName);
        }
        else
        {
            if (!(fieldName in parent))
            {
                parent[fieldName] = {};
            }

            parent[fieldName][viewModel.Uid] = ko.observable(viewModel);

            // Add remove handler to clean up viewmodel when removed from parent
            viewModel.View.on('DOMNodeRemoved', function ()
            {
                delete parent[fieldName][viewModel.Uid];
                
                if($.isEmptyObject(parent[fieldName]))
                {
                    delete parent[fieldName];
                }
                
                var childIndex = parent.Children.indexOf(viewModel);
                if(childIndex > -1)
                {
                    parent.Children.splice(childIndex, 1);
                }
            });

            // Add databinding for visibility and context to the component root node
            componentRoot.attr('data-bind', 'visible: $parent.' + fieldName + '["' + viewModel.Uid + '"]().Visible, with: $parent.' + fieldName + '["' + viewModel.Uid + '"]');
        }

        componentRoot.attr('id', viewModel.Uid);
        componentRoot.hide();   // Hide by default so that the views don't flash on the screen before knockout kicks in

        // Compile the view using its parameters
        var compiledView = _.template(component.Template, params);

        // Insert the compiled view into the DOM
        componentRoot.html(compiledView);

        // Type any child components
        TypeComponents(componentRoot);

        return viewModel;
    }
    var BuildComponent = _.bind(_BuildComponent, Application);

    function TypeComponents(root)
    {
        // Select foreach data-binds and mark components inside as having type "collection"
        var collectionComponents = root.find('[data-bind*="foreach:"] [data-component]');
        collectionComponents.attr('data-component-type', 'collection');

        // Select if and ifnot data-binds and mark components inside as having type "conditional"
        var conditionalComponents = root.find('[data-bind*="if:"],[data-bind*="ifnot:"] [data-component]');
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

        if (componentType && componentType == 'collection')
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
                _(expandedModels).each(function (comp) { $(comp).triggerHandler('Loaded'); });

                $(viewModel).triggerHandler('Loaded');
            }
        }
        else if (componentType && componentType == 'conditional')
        {
            Application.InjectComponent(node);
        }
    };

    return Application;
});
