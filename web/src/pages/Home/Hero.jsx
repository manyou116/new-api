import React from 'react';
import { theme } from './theme/design';
import { Button } from '@douyinfe/semi-ui';
import { useNavigate } from 'react-router-dom';

export const CopyButton = ({ text, style }) => {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      style={{
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        padding: 4,
        color: copied ? theme.colors.success.main : theme.colors.primary.main,
        ...style,
      }}
    >
      {copied ? '✅' : '📋'}
    </button>
  );
};

const Hero = () => {
  const navigate = useNavigate();
  const baseUrl =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://api.example.com';
  const highlights = [
    { label: 'OpenAI SDK 兼容', desc: '现有客户端只需替换 base_url' },
    {
      label: '多模型统一路由',
      desc: '一个 Key 访问 OpenAI、Claude、Gemini 等',
    },
    { label: '按量透明计费', desc: '统一账单，模型倍率实时可查' },
    { label: '调用日志可追踪', desc: '请求、扣费和错误链路清晰可见' },
  ];

  return (
    <section
      style={{
        position: 'relative',
        padding: '120px 24px 80px',
        background: 'linear-gradient(180deg, #F8FAFC 0%, #FFFFFF 100%)',
        overflow: 'hidden',
        borderBottom: `1px solid ${theme.colors.border.default}`,
      }}
    >
      <div
        style={{
          maxWidth: theme.layout.maxWidth,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          position: 'relative',
          zIndex: 2,
        }}
      >
        {/* Badge */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 16px',
            background: theme.colors.primary.light,
            borderRadius: 100,
            border: `1px solid ${theme.colors.primary.main}30`,
            marginBottom: 32,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: theme.colors.primary.main,
            }}
          />
          <span
            style={{
              ...theme.typography.small,
              color: theme.colors.primary.main,
              fontWeight: 600,
            }}
          >
            兼容 OpenAI SDK 的多模型网关
          </span>
        </div>

        {/* Headline */}
        <h1
          style={{
            ...theme.typography.h1,
            maxWidth: 900,
            marginBottom: 24,
            letterSpacing: '-0.02em',
            lineHeight: 1.2,
          }}
        >
          一个 API Key <br />
          <span style={{ color: theme.colors.primary.main }}>
            接入主流 AI 模型
          </span>
        </h1>

        {/* Subtitle */}
        <p
          style={{
            ...theme.typography.subtitle,
            maxWidth: 680,
            marginBottom: 48,
            fontSize: 20,
          }}
        >
          兼容 OpenAI 调用方式，统一管理 OpenAI、Claude、Gemini、DeepSeek、Qwen
          等模型。按量计费、统一账单、开箱即用。
        </p>

        {/* CTAs */}
        <div
          style={{
            display: 'flex',
            gap: 16,
            flexWrap: 'wrap',
            justifyContent: 'center',
            marginBottom: 64,
          }}
        >
          <Button
            theme='solid'
            size='large'
            onClick={() => navigate('/register')}
            style={{
              padding: '16px 36px',
              fontSize: 18,
              fontWeight: 600,
              borderRadius: theme.radius.md,
              background: theme.colors.primary.main,
              boxShadow: '0 8px 20px -6px rgba(79, 70, 229, 0.4)',
            }}
          >
            免费获取 API Key
          </Button>
          <Button
            theme='light'
            size='large'
            onClick={() =>
              document
                .getElementById('quick-start')
                ?.scrollIntoView({ behavior: 'smooth' })
            }
            style={{
              padding: '16px 36px',
              fontSize: 18,
              fontWeight: 600,
              borderRadius: theme.radius.md,
              background: '#fff',
              color: theme.colors.text.title,
              border: `1px solid ${theme.colors.border.default}`,
              boxShadow: theme.shadows.sm,
            }}
          >
            查看接入示例
          </Button>
        </div>

        {/* Command Line Hint */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 24px',
            background: theme.colors.background.secondary,
            borderRadius: theme.radius.lg,
            border: `1px solid ${theme.colors.border.default}`,
            maxWidth: '100%',
            overflowX: 'auto',
          }}
        >
          <span
            style={{
              ...theme.typography.small,
              color: theme.colors.text.muted,
              fontFamily: 'monospace',
              whiteSpace: 'nowrap',
            }}
          >
            $ curl {baseUrl}/v1/chat/completions
          </span>
          <CopyButton text={`curl ${baseUrl}/v1/chat/completions`} />
        </div>

        <div
          style={{
            width: '100%',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
            gap: 16,
            marginTop: 48,
          }}
        >
          {highlights.map((item) => (
            <div
              key={item.label}
              style={{
                textAlign: 'left',
                background: '#fff',
                border: `1px solid ${theme.colors.border.default}`,
                borderRadius: theme.radius.lg,
                padding: 20,
                boxShadow: theme.shadows.sm,
              }}
            >
              <div
                style={{
                  ...theme.typography.body,
                  color: theme.colors.text.title,
                  fontWeight: 700,
                  marginBottom: 6,
                }}
              >
                {item.label}
              </div>
              <div style={{ ...theme.typography.small, lineHeight: 1.6 }}>
                {item.desc}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Hero;
