import { PageLoader } from "@/components/PageLoader";

import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { MainLayout } from "@/layouts/MainLayout";
import { PATHS } from "@/routes/paths";
import { RedirectIfAuthed, RequireAuth, RequireTeam } from "@/routes/guards";

// ✅ 登录页首屏直接加载
import { LoginPage } from "@/pages/Login/LoginPage";

// ✅ 忘记密码页（匿名可访问，与登录页同级）
const ForgotPasswordPage = lazy(() => import("@/pages/ForgotPassword/ForgotPasswordPage"));

// ✅ 其他所有独立页面用懒加载
const WelcomePage = lazy(() => import("@/pages/Welcome/WelcomePage"));
const CreateTeamPage = lazy(() => import("@/pages/CreateTeam/CreateTeamPage"));
const JoinTeamPage = lazy(() => import("@/pages/JoinTeam/JoinTeamPage"));
const MyTeamsPage = lazy(() => import("@/pages/MyTeams/MyTeamsPage"));
const ChatWorkspacePage = lazy(
  () => import("@/pages/ChatWorkspace/ChatWorkspacePage"),
);
const GitHubIntegrationPage = lazy(
  () => import("@/pages/GitHubIntegration/GitHubIntegrationPage"),
);
const GitHubOAuthPage = lazy(
  () => import("@/pages/GitHubOAuth/GitHubOAuthPage"),
);
const GithubInstallationReposPage = lazy(
  () => import("@/pages/GitHubIntegration/GithubInstallationReposPage"),
);
const BindRepoToProjectPage = lazy(
  () => import("@/pages/GitHubIntegration/BindRepoToProjectPage"),
);
const TeamDetailPage = lazy(() => import("@/pages/TeamDetail/TeamDetailPage"));
const TeamSettingsPage = lazy(
  () => import("@/pages/TeamDetail/TeamSettingsPage"),
);
const TeamActivitiesPage = lazy(
  () => import("@/pages/TeamDetail/TeamActivitiesPage"),
);
const CreateProjectPage = lazy(
  () => import("@/pages/CreateProject/CreateProjectPage"),
);
const TeamAuthorizedReposPage = lazy(
  () => import("@/pages/GitHubIntegration/TeamAuthorizedReposPage"),
);
const ProjectDetailLayout = lazy(
  () => import("@/pages/ProjectDetail/ProjectDetailLayout"),
);
const RequirementChatPage = lazy(
  () => import("@/pages/ProjectDetail/RequirementChatPage"),
);
const DiffReviewPage = lazy(
  () => import("@/pages/ProjectDetail/DiffReviewPage"),
);
const MergeRequestDetailPage = lazy(
  () =>
    import("@/pages/ProjectDetail/MergeRequestDetail/MergeRequestDetailPage"),
);
const CqReviewPage = lazy(
  () =>
    import("@/pages/ProjectDetail/Testset/CqReviewPage"),
);
const QualityGateReviewPage = lazy(
  () =>
    import("@/pages/ProjectDetail/Testset/QualityGateReviewPage"),
);
const TestsetManagePage = lazy(
  () =>
    import("@/pages/ProjectDetail/Testset/TestsetManagePage"),
);
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage"));
const ForbiddenPage = lazy(() => import("@/pages/ForbiddenPage"));
const TaskDetailPage = lazy(
  () => import("@/pages/ProjectDetail/TaskDetail/TaskDetailPage"),
);
const TaskRunDetailPage = lazy(
  () => import("@/pages/ProjectDetail/TaskRunDetail/TaskRunDetailPage"),
);
const TaskCenterPage = lazy(
  () => import("@/pages/ProjectDetail/TaskCenter/TaskCenterPage"),
);
const DiffCenterPage = lazy(
  () => import("@/pages/ProjectDetail/DiffCenter/DiffCenterPage"),
);
const DeliveryCenterPage = lazy(
  () => import("@/pages/ProjectDetail/DeliveryCenter/DeliveryCenterPage"),
);
const AgentTeamPage = lazy(
  () => import("@/pages/ProjectDetail/AgentTeam/AgentTeamPage"),
);
const OverviewPage = lazy(async () => ({
  default: (await import("@/pages/ProjectDetail/OverviewPage")).OverviewPage,
}));
const SkillsPage = lazy(async () => ({
  default: (await import("@/pages/ProjectDetail/SkillPage")).SkillPage,
}));
const MemoryPage = lazy(async () => ({
  default: (await import("@/pages/ProjectDetail/MemoryPage")).MemoryPage,
}));
const CodePage = lazy(async () => ({
  default: (await import("@/pages/ProjectDetail/CodePage")).CodePage,
}));
const TestsetPage = lazy(async () => ({
  default: (await import("@/pages/ProjectDetail/Testset/TestsetPage")).TestsetPage,
}));
const MembersPage = lazy(async () => ({
  default: (await import("@/pages/ProjectDetail/MembersPage")).MembersPage,
}));
const SettingsPage = lazy(async () => ({
  default: (await import("@/pages/ProjectDetail/Settings/SettingsPage")).SettingsPage,
}));

export function AppRouter() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route
            path={PATHS.LOGIN}
            element={
              <RedirectIfAuthed>
                <LoginPage />
              </RedirectIfAuthed>
            }
          />

          <Route
            path={PATHS.FORGOT_PASSWORD}
            element={
              <RedirectIfAuthed>
                <ForgotPasswordPage />
              </RedirectIfAuthed>
            }
          />

          <Route element={<RequireAuth />}>
            <Route path={PATHS.WELCOME} element={<WelcomePage />} />

            <Route path={PATHS.APP} element={<MainLayout />}>
              <Route index element={<Navigate to={PATHS.MY_TEAMS} replace />} />
              <Route path="teams" element={<MyTeamsPage />} />
              <Route path="teams/create" element={<CreateTeamPage />} />
              <Route path="teams/join" element={<JoinTeamPage />} />
              <Route path="settings/integrations/github" element={<GitHubOAuthPage />} />

              <Route element={<RequireTeam />}>
                <Route path="teams/:teamId" element={<TeamDetailPage />}>
                  {/* 团队设置作为团队详情的路由层子视图：点击侧栏切换，不跳转新页面 */}
                  <Route path="settings" element={<TeamSettingsPage />} />
                </Route>
                <Route
                  path="teams/:teamId/activities"
                  element={<TeamActivitiesPage />}
                />
                <Route
                  path="teams/:teamId/projects/create"
                  element={<CreateProjectPage />}
                />
                <Route
                  path="teams/:teamId/github/authorized-repos"
                  element={<TeamAuthorizedReposPage />}
                />
                <Route path="chat" element={<ChatWorkspacePage />} />
                <Route
                  path="integrations/github"
                  element={<GitHubIntegrationPage />}
                />
                <Route
                  path="integrations/github/installations/:installationId/repositories"
                  element={<GithubInstallationReposPage />}
                />
                <Route
                  path="integrations/github/bind-repo"
                  element={<BindRepoToProjectPage />}
                />

                <Route
                  path="projects/:projectId"
                  element={<ProjectDetailLayout />}
                >
                  <Route index element={<Navigate to="req-chat" replace />} />
                  <Route path="overview" element={<OverviewPage />} />

                  <Route
                    path="req-chat/:groupId"
                    element={<RequirementChatPage />}
                  />
                  <Route path="req-chat" element={<RequirementChatPage />} />

                  <Route path="tasks" element={<TaskCenterPage />} />
                  <Route
                    path="tasks/:taskId/executions/:taskRunId"
                    element={<TaskRunDetailPage />}
                  />
                  <Route path="tasks/:taskId" element={<TaskDetailPage />} />
                  <Route path="diffs" element={<DeliveryCenterPage />} />
                  <Route path="diffs/:diffId" element={<DiffCenterPage />} />
                  <Route path="workflow" element={<Navigate to="tasks" replace />} />
                  <Route path="agents" element={<AgentTeamPage />} />

                  <Route path="skills" element={<SkillsPage />} />
                  <Route path="memory" element={<MemoryPage />} />
                  <Route
                    path="code/mr/:mergeRequestId"
                    element={<MergeRequestDetailPage />}
                  />
                  <Route
                    path="code/diff/:diffId"
                    element={<DiffReviewPage />}
                  />
                  <Route path="code" element={<CodePage />} />
                  <Route path="testset" element={<TestsetPage />} />
                  <Route path="testset/manage" element={<TestsetManagePage />} />
                  <Route path="quality-gate" element={<QualityGateReviewPage />} />
                  <Route path="cq-review" element={<CqReviewPage />} />
                  <Route path="members" element={<MembersPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                </Route>
              </Route>

              <Route path="*" element={<NotFoundPage />} />
            </Route>

            <Route path="/403" element={<ForbiddenPage />} />
          </Route>

          <Route path="/" element={<Navigate to={PATHS.LOGIN} replace />} />
          <Route path="*" element={<Navigate to={PATHS.LOGIN} replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
