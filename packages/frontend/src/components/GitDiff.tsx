import React from "react";

interface Props {
  diff: string;
}

export const GitDiff: React.FC<Props> = ({ diff }) => {
  if (!diff.trim()) {
    return <div className="git-diff git-diff-empty">(no changes)</div>;
  }
  const lines = diff.split("\n");
  return (
    <pre className="git-diff">
      {lines.map((line, i) => {
        let cls = "git-diff-line";
        if (line.startsWith("+++") || line.startsWith("---")) {
          cls += " git-diff-meta";
        } else if (line.startsWith("@@")) {
          cls += " git-diff-hunk";
        } else if (line.startsWith("+")) {
          cls += " git-diff-add";
        } else if (line.startsWith("-")) {
          cls += " git-diff-del";
        } else if (line.startsWith("diff ") || line.startsWith("index ")) {
          cls += " git-diff-meta";
        }
        return (
          <span key={i} className={cls}>
            {line || " "}
            {"\n"}
          </span>
        );
      })}
    </pre>
  );
};
