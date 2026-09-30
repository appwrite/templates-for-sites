import 'package:jaspr/dom.dart';
import 'package:jaspr/jaspr.dart';

import '../data/models/log.dart';
import '../data/models/project_info.dart';
import 'icons.dart';

/// The collapsible panel at the bottom of the page with project details and ping logs.
class LogsPanel extends StatelessComponent {
  const LogsPanel({
    required this.logs,
    required this.projectInfo,
    required this.open,
    required this.onToggle,
    super.key,
  });

  final List<Log> logs;
  final ProjectInfo projectInfo;
  final bool open;
  final VoidCallback onToggle;

  @override
  Component build(BuildContext context) {
    return aside(classes: 'logs', [
      details(open: open, classes: 'logs-details', [
        summary(
          classes: 'logs-summary',
          events: {
            // The open state lives in the component, so handle the toggle here
            // instead of letting the browser flip it.
            'click': (event) {
              event.preventDefault();
              onToggle();
            },
          },
          [
            div(classes: 'logs-title', [
              span(classes: 'logs-label', [.text('Logs')]),
              if (logs.isNotEmpty)
                div(classes: 'logs-count', [
                  span([.text('${logs.length}')]),
                ]),
            ]),
            div(classes: 'icon', [chevronDownIcon()]),
          ],
        ),
        div(classes: 'logs-body', [
          div(classes: 'project', [
            div(classes: 'section-header', [.text('Project')]),
            div(classes: 'project-grid', [
              _projectField('Endpoint', projectInfo.endpoint),
              _projectField('Project-ID', projectInfo.projectId),
              _projectField('Project name', projectInfo.projectName),
            ]),
          ]),
          div(classes: 'logs-table-wrap', [
            table(classes: 'logs-table', [
              thead([
                tr(classes: 'table-header', [
                  if (logs.isEmpty)
                    td(classes: 'cell-first', [.text('Logs')])
                  else ...[
                    td(classes: 'cell-first cell-date', [.text('Date')]),
                    td([.text('Status')]),
                    td([.text('Method')]),
                    td(classes: 'cell-wide', [.text('Path')]),
                    td(classes: 'cell-wide', [.text('Response')]),
                  ],
                ]),
              ]),
              tbody([
                if (logs.isEmpty)
                  tr([
                    td(classes: 'cell-first mono', [.text('There are no logs to show')]),
                  ])
                else
                  for (final log in logs) _logRow(log),
              ]),
            ]),
          ]),
        ]),
      ]),
    ]);
  }

  Component _projectField(String label, String value) {
    return div(classes: 'project-field', [
      span(classes: 'project-field-label', [.text(label)]),
      span(classes: 'truncate', [.text(value)]),
    ]);
  }

  Component _logRow(Log log) {
    return tr([
      td(classes: 'cell-first mono', [.text(log.date)]),
      td([
        div(classes: log.status >= 400 ? 'log-status log-status-error' : 'log-status log-status-success', [
          .text('${log.status}'),
        ]),
      ]),
      td([.text(log.method)]),
      td(classes: 'cell-wide', [.text(log.path)]),
      td(classes: 'cell-wide mono', [.text(log.response)]),
    ]);
  }
}
