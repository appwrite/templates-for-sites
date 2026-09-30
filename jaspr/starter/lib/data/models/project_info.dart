/// The Appwrite project this app is connected to.
class ProjectInfo {
  const ProjectInfo({
    required this.endpoint,
    required this.projectId,
    required this.projectName,
  });

  final String endpoint;
  final String projectId;
  final String projectName;
}
