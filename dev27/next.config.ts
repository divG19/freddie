import { withAui } from "@assistant-ui/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "021c41945dfe57bc96683a654df4377d--3000.coshell.ai"],
  async rewrites() {
    return [
      {
        source: "/api/rooms/:path*",
        destination: "http://127.0.0.1:8000/api/rooms/:path*",
      },
      {
        source: "/api/langgraph/:path*",
        destination: "http://127.0.0.1:2024/:path*",
      },
    ];
  },
};

export default withAui(nextConfig);
