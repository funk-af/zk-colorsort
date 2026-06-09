import { createRouter, createWebHistory } from "vue-router";

const routes = [
  {
    path: "/",
    name: "play",
    component: () => import("../components/PlayPage.vue"),
  },
  {
    path: "/build",
    name: "builder",
    component: () => import("../components/BuilderPage.vue"),
  },
  {
    path: "/:puzzleCode(.*)",
    name: "play-shared",
    component: () => import("../components/PlayPage.vue"),
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
