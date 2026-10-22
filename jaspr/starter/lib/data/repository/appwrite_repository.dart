import 'package:dart_appwrite/dart_appwrite.dart';

import '../../config/environment.dart';
import '../models/log.dart';
import '../models/project_info.dart';

/// A repository responsible for handling network interactions with the Appwrite server.
///
/// It provides a helper method to ping the server.
class AppwriteRepository {
  static const String pingPath = '/v1/ping';

  AppwriteRepository._internal();

  static final AppwriteRepository _instance = AppwriteRepository._internal();

  /// Singleton instance getter
  factory AppwriteRepository() => _instance;

  // Created on first use, inside `ping`, so that an endpoint that isn't configured
  // yet shows up as an error in the logs instead of breaking the page.
  late final Client _client = Client()
      .setEndpoint(Environment.appwritePublicEndpoint)
      .setProject(Environment.appwriteProjectId);

  ProjectInfo getProjectInfo() {
    return const ProjectInfo(
      endpoint: Environment.appwritePublicEndpoint,
      projectId: Environment.appwriteProjectId,
      projectName: Environment.appwriteProjectName,
    );
  }

  /// Pings the Appwrite server and captures the response.
  ///
  /// @return [Log] containing request and response details.
  Future<Log> ping() async {
    try {
      final response = await _client.ping();
      return _log(status: 200, response: response);
    } on AppwriteException catch (error) {
      return _log(status: error.code ?? 500, response: error.message ?? 'Unknown error');
    } catch (_) {
      return _log(status: 500, response: 'Something went wrong');
    }
  }

  Log _log({required int status, required String response}) {
    return Log(
      date: _getCurrentDate(),
      status: status,
      method: 'GET',
      path: pingPath,
      response: response,
    );
  }

  /// Retrieves the current date in the format "MMM dd, HH:mm".
  String _getCurrentDate() {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    final now = DateTime.now();
    String twoDigits(int value) => value.toString().padLeft(2, '0');
    return '${months[now.month - 1]} ${twoDigits(now.day)}, ${twoDigits(now.hour)}:${twoDigits(now.minute)}';
  }
}
