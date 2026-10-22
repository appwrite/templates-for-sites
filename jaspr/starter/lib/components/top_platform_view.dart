import 'package:jaspr/dom.dart';
import 'package:jaspr/jaspr.dart';

import 'icons.dart';

/// The Jaspr and Appwrite logos, joined by a line once the connection succeeds.
class TopPlatformView extends StatelessComponent {
  const TopPlatformView({required this.connected, super.key});

  final bool connected;

  @override
  Component build(BuildContext context) {
    return div(classes: 'platforms', [
      _platform(img(src: 'images/jaspr.svg', alt: 'Jaspr logo', classes: 'platform-logo', width: 56, height: 56)),
      div(classes: connected ? 'connection connection-visible' : 'connection', [
        div(classes: 'connection-line connection-line-left', []),
        div(classes: 'connection-check', [checkIcon()]),
        div(classes: 'connection-line connection-line-right', []),
      ]),
      _platform(img(src: 'images/appwrite.svg', alt: 'Appwrite logo', classes: 'platform-logo', width: 56, height: 56)),
    ]);
  }

  Component _platform(Component logo) {
    return div(classes: 'platform', [
      div(classes: 'platform-inner', [logo]),
    ]);
  }
}
