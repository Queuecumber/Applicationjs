// Application class
// Requries a datamodel in the "Model" module
// Manages switching ui components which are views and associated viewmodels
// Views are HTML partial pages, ViewModels are the underlying databindings and behavior
// of the View. The ViewModel should take and return data to the Model object.
define(['knockout', 'Model', 'underscore', 'jquery'], function (ko, Model, _, $)
{
    var Application = {
    
        // Creates the application by providing ui component information. The callback is called
        // when all view nodes have been loaded into the page
        Create: function (components, callback)
        {
            var self = this;
            
            self.Model = Model;

            // Set up each component
            var cnt = 0; // Holds the number of completed view loads
            _.each(components, function (comp)
            {
                // Application.ComponentName is the ViewModel class to be instantiated when the UI is shown
                self[comp.Name] = comp.ViewModel;
                self[comp.Name + '_Inst'] = ko.observable();    // Application.ComponentName_Inst is the actual instance of the ViewModel

                // Create a div to hold the View with the ViewModel instance is the context and controling the visibility of the view
                var viewNode = $('<div id="' + comp.Name + '" data-bind="visible: ' + comp.Name + '_Inst(), with: ' + comp.Name + '_Inst"></div>');
                viewNode.hide();    // Views are hidden by default or they will flash on the screen before knockout is fully loaded
                
                // If the view has a stylesheet load that too
                if('Style' in comp)
                {
                    var styleLink = $('<link rel="stylesheet" type="text/css" href="' + comp.Style + '"/>');
                    $('head').append(styleLink);
                }
                
                //  Make a template node to hold the raw view before it has been processed for template replacement 
                var templateNode = $('<script type="text/template"></script>');

                // Load the view into the template node
                templateNode.load(comp.View, '', function ()
                {
                    // When the loading has been completed, perform the template expansion
                    var rawValue = templateNode.html();
                    var compiled = _.template(rawValue, comp.Parameters);
                    
                    // Insert the compiled template into the view node and add it to the page body
                    viewNode.html(compiled);
                    $('body').append(viewNode);
                    
                    // Increment the loaded view count
                    cnt++;

                    // If all the views have been loaded (since this all happens asynchronously) call the callback
                    if (cnt == components.length)
                        callback();
                });
            });
        },
        
        // Switches the active view
        Activate: function (viewName, params)
        {
            var self = this;
        
            // If there is an active viewmodel, clear it out. This automatically hides the associated view
            if(self.ActiveView() != undefined)
                self[self.ActiveView()](null);
    
            // Instantiate the new viewmodel, this automatically shows the associated view
            self[viewName + '_Inst'](new self[viewName](params));
            self.ActiveView(viewName + '_Inst');    // Keep track of the active view
        },
        
        // Tracks the active view by storing its parameter name 
        ActiveView: ko.observable()
    }

    return Application;
});
