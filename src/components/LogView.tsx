import React, { useEffect, useRef } from 'react';

export default function LogView({ log, height = 320 }: { log: string; height?: number }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);
  return (
    <pre
      ref={ref}
      style={{
        height,
        margin: 0,
        padding: 12,
        overflow: 'auto',
        background: '#0a0e13',
        border: '1px solid #1f2a37',
        borderRadius: 8,
        fontSize: 12,
        lineHeight: 1.6,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        color: '#a9dc76',
      }}
    >
      {log || '// 暂无输出'}
    </pre>
  );
}
