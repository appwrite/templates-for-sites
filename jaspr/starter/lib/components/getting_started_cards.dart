import 'package:jaspr/dom.dart';
import 'package:jaspr/jaspr.dart';

import 'icons.dart';

/// Links to help you continue after the connection check.
class GettingStartedCards extends StatelessComponent {
  const GettingStartedCards({super.key});

  @override
  Component build(BuildContext context) {
    return div(classes: 'cards', [
      div(classes: 'card', [
        h2(classes: 'card-title', [.text('Edit your app')]),
        p([
          .text('Edit '),
          code([.text('lib/app.dart')]),
          .text(' to get started with building your app.'),
        ]),
      ]),
      _linkCard(
        href: 'https://cloud.appwrite.io',
        title: 'Go to console',
        description: 'Navigate to the console to control and oversee the Appwrite services.',
      ),
      _linkCard(
        href: 'https://appwrite.io/docs',
        title: 'Explore docs',
        description: 'Discover the full power of Appwrite by diving into our documentation.',
      ),
    ]);
  }

  Component _linkCard({required String href, required String title, required String description}) {
    return a(href: href, target: Target.blank, attributes: {'rel': 'noopener noreferrer'}, [
      div(classes: 'card', [
        div(classes: 'card-header', [
          h2(classes: 'card-title', [.text(title)]),
          arrowRightIcon(classes: 'card-arrow'),
        ]),
        p([.text(description)]),
      ]),
    ]);
  }
}
