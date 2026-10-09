import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";

export default function PageTransition({ section, children }: { section: string; children: ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let animation: Animation | undefined;
    const enter = () => {
      animation?.cancel();
      if (!reducedMotion.matches) {
        animation = content.animate(
          [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "translateY(0)" }],
          { duration: 220, easing: "cubic-bezier(0.2, 0.65, 0.3, 1)" },
        );
      }
    };
    const heading = () => content.querySelector("h1, .page-title, h2")?.textContent?.trim() ?? "";
    let previousHeading = heading();
    enter();
    // Detail/back navigation uses local state; ignore ordinary data/timer updates.
    const observer = new MutationObserver(() => {
      const nextHeading = heading();
      if (nextHeading && nextHeading !== previousHeading) {
        previousHeading = nextHeading;
        enter();
      }
    });
    observer.observe(content, { childList: true, subtree: true, characterData: true });
    const cancelMotion = () => { if (reducedMotion.matches) animation?.cancel(); };
    reducedMotion.addEventListener("change", cancelMotion);
    return () => { observer.disconnect(); animation?.cancel(); reducedMotion.removeEventListener("change", cancelMotion); };
  }, [section]);

  return <div className="page-transition-content" ref={contentRef}>{children}</div>;
}
