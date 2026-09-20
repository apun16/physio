"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportSidekickFailure } from "../../lib/rehab-guardian/reporter";

type Props = { children: ReactNode };

export default class SidekickBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    try {
      reportSidekickFailure();
    } catch {
      // never stop the game
    }
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}
