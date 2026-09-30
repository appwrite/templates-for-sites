import 'package:jaspr/dom.dart';
import 'package:jaspr/jaspr.dart';

import '../data/models/status.dart';
import 'icons.dart';

/// The connection check: a heading that reflects the ping status and the ping button.
class ConnectionStatusView extends StatelessComponent {
  const ConnectionStatusView({required this.status, required this.onPing, super.key});

  final Status status;
  final VoidCallback onPing;

  @override
  Component build(BuildContext context) {
    return section(classes: 'status', [
      if (status == Status.loading)
        div(classes: 'status-loading', [
          div(attributes: {'role': 'status'}, [
            spinner(),
            span(classes: 'sr-only', [.text('Loading...')]),
          ]),
          span([.text('Waiting for connection...')]),
        ])
      else
        h1(classes: 'status-title', [
          .text(status == Status.success ? 'Congratulations!' : 'Check connection'),
        ]),
      p(classes: 'status-description', [
        if (status == Status.success)
          .text('You connected your app successfully.')
        else if (status != Status.loading)
          .text('Send a ping to verify the connection'),
      ]),
      if (status != Status.loading)
        button(classes: 'ping-button', onClick: onPing, [
          span([.text('Send a ping')]),
        ]),
    ]);
  }
}
