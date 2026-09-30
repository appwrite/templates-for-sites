import 'package:jaspr/dom.dart';
import 'package:jaspr/jaspr.dart';

import 'components/connection_status_view.dart';
import 'components/getting_started_cards.dart';
import 'components/logs_panel.dart';
import 'components/top_platform_view.dart';
import 'data/models/log.dart';
import 'data/models/status.dart';
import 'data/repository/appwrite_repository.dart';

// The main component of your application.
//
// By using the @client annotation, this component is rendered on the server and then
// mounted on the client, where the ping button and logs panel become interactive.
@client
class App extends StatefulComponent {
  const App({super.key});

  @override
  State<App> createState() => AppState();
}

class AppState extends State<App> {
  final AppwriteRepository _repository = AppwriteRepository();
  final List<Log> _logs = [];
  Status _status = Status.idle;
  bool _showLogs = false;

  Future<void> _sendPing() async {
    if (_status == Status.loading) return;
    setState(() => _status = Status.loading);

    final log = await _repository.ping();

    setState(() {
      _logs.insert(0, log);
      _status = log.status == 200 ? Status.success : Status.error;
      _showLogs = true;
    });
  }

  @override
  Component build(BuildContext context) {
    return div(classes: 'page', [
      main_(classes: 'main checker-background', [
        TopPlatformView(connected: _status == Status.success),
        ConnectionStatusView(status: _status, onPing: _sendPing),
        const GettingStartedCards(),
      ]),
      LogsPanel(
        logs: _logs,
        projectInfo: _repository.getProjectInfo(),
        open: _showLogs,
        onToggle: () => setState(() => _showLogs = !_showLogs),
      ),
    ]);
  }
}
