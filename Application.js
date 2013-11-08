// Application class
// Requries a datamodel in the "Model" module
// Manages switching ui components which are views and associated viewmodels
// Views are HTML partial pages, ViewModels are the underlying databindings and behavior
// of the View. The ViewModel should take and return data to the Model object.
define(['knockout', 'underscore', 'jquery'],
function (ko, _, $)
{
    // Applies the application name to the DOM
    function ApplyName(app)
    {
        var titleElem = $('title');
        if (titleElem.length > 0)
        {
            titleElem.text(app.Name);
        }
        else
        {
            titleElem = $('<title>' + app.Name + '</title>');
            $('head').append(titleElem);
        }

        var nameElements = $('.AppName');
        nameElements.text(app.Name);
    }

    function ParseJsObject(string)
    {
        // Use 'eval' to create a javascript object from the malformed JSON
        // NOTE: there are some security concerns with this method
        var parenString = '(' + string + ')'; // object literals must be enclosed in parenthesis for eval to work properly
        var obj = eval(parenString);

        return obj;
    }

    // Loads view templates and styles for each component
    function LoadComponents(app)
    {
        // Put JQuery AJAX into synchronous mode for this algorithm to work, we will clear this flag once page loading is complete
        $.ajaxSetup({ async: false });

        // Preload styles and templates for each component
        _(app.Components).each(function (comp)
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

    // Page Composition Algorithm:
    // -----------------------------------
    // 1. Find all data-component nodes and insert into queue (processing the DOM breadth-first)
    // 2. Take a node off the queue, parse the nodes parameters if any
    // 3. add events and fields to the node and loaded component *
    // 4. find the components parent, use Application if none, and add variable containers for that component
    // 5. add visibility and context databindings to the root node
    // 6. insert the expanded template into the components root as html
    // 7. parse the components html children  for data-component nodes and add them to the queue
    // 8. When the queue is empty, the page is finished loading
    // 
    // * Events: 'activate', 'finish'  * Fields: Node, Parent, Visible(?)
    // * Ignore any nodes with a data-component of unknown name
    function ComposePage(app)
    {
        // Parse the DOM and expand any data-component nodes with their HTML. 
        // This step will initialize the views and viewmodels in a breadth first traversal
        var componentsQueue = $('[data-component]').toArray();

        while (componentsQueue.length > 0)
        {
            var componentRoot = $(componentsQueue.shift()); // dequeue operation
            var componentName = componentRoot.data('component');

            // Find the component description
            var component = _(app.Components).findWhere({ Name: componentName });
            if (component)
            {
                // Get the components view parameters
                var params = componentRoot.data('parameters');
                if (params)
                {
                    params = ParseJsObject(params);
                }

                // Get the node id to use as a field name
                var fieldName = componentRoot.attr('id');

                // Create the view model and add standard fields
                var viewModel = new component.ViewModel();
                viewModel.Visible = ko.observable(false); // Hidden by default
                viewModel.Id = fieldName;
                viewModel.ViewParameters = params;
                viewModel.Children = ko.observableArray();
                viewModel.Find = app.Find;
                viewModel.Activate = app.Activate;
                viewModel.Finish = app.Finish;

                // Find the parent of the view, using app when there is no parent
                var parentId = componentRoot.data('parent');
                var parent = app;
                if (parentId)
                {
                    var parent = app.Find(parentId);
                }

                // Add the viewmodel to its parent
                parent[fieldName] = ko.observable(viewModel);
                parent.Children.push(viewModel);

                // Add databinding for visibility and context to the component root node
                componentRoot.attr('data-bind', 'visible: ' + fieldName + '().Visible, with:' + fieldName);
                componentRoot.hide();   // Hide by default so that the views don't flash on the screen before knockout kicks in

                // Compile the view using its parameters
                var compiledView = _.template(component.Template, params);

                // Insert the compiled view into the DOM
                componentRoot.html(compiledView);

                // Find any child data-component nodes and push them onto the queue
                var childComponents = componentRoot.find('[data-component]').toArray();
                _(childComponents).each(function (child)
                {
                    // Set the parent id so that we can get it later
                    $(child).data('parent', fieldName);
                    componentsQueue.push(child);
                });
            }
        }
    }

    var Application = {

        Model: {},

        Name: '',

        Components: [],

        Children: ko.observableArray(),

        // Creates the application by providing ui component information. The callback is called
        // when all view nodes have been loaded into the page
        Create: function (name, model, components)
        {
            var self = this;

            self.Model = model;
            self.Name = name;
            self.Components = components;

            ApplyName(self);
            LoadComponents(self);
            ComposePage(self);
        },

        Activate: function (params)
        {
            this.Visible(true);
            $(this).triggerHandler('Activate', [params]);
        },

        Finish: function (viewName, params)
        {
            this.Visible(false);
            $(this).triggerHandler('Finish', [params]);
        },

        // Find an component by id using a depth first search (recursive)
        Find: function (componentId)
        {
            var target = null;

            _(this.Children()).each(function (child)
            {
                var foundChild = null;
                if (child.Id == componentId)
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
        }
    }

    return Application;
});
