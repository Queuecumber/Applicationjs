define(['knockout', 'Model', 'underscore', 'jquery'], function (ko, Model, _, $)
{
    var Application = {
        Create: function (components, callback)
        {
            var self = this;
            
            self.Model = Model;

            var cnt = 0;
            _.each(components, function (comp)
            {
                self[comp.Name] = comp.ViewModel;
                self[comp.Name + '_Inst'] = ko.observable();

                var viewNode = $('<div id="' + comp.Name + '" data-bind="visible: ' + comp.Name + '_Inst(), with: ' + comp.Name + '_Inst"></div>');
                viewNode.hide();
                
                var templateNode = $('<script type="text/template"></script>');

                templateNode.load(comp.View, '', function ()
                {
                    var rawValue = templateNode.html();
                    var compiled = _.template(rawValue, comp.Parameters);
                    
                    viewNode.html(compiled);
                    $('body').append(viewNode);
                    
                    cnt++;

                    if (cnt == components.length)
                        callback();
                });
            });
        },
        
        Activate: function (viewName)
        {
            var self = this;
        
            if(self.ActiveView() != undefined)
                self[self.ActiveView()](null);

            self[viewName + '_Inst'](new self[viewName]());
            self.ActiveView(viewName + '_Inst');
        },
        
        ActiveView: ko.observable()
    }

    return Application;
});
