/// A single request made to Appwrite, as shown in the logs panel.
class Log {
  const Log({
    required this.date,
    required this.status,
    required this.method,
    required this.path,
    required this.response,
  });

  final String date;
  final int status;
  final String method;
  final String path;
  final String response;
}
