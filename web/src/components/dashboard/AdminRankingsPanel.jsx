/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import React from 'react';
import { Card, Empty, Tag, Typography } from '@douyinfe/semi-ui';
import { renderNumber, renderQuota, timestamp2string } from '../../helpers';

const { Text } = Typography;

const AdminRankingsPanel = ({ rankings, loading, t }) => {
  const sections = [
    {
      key: 'by_request_count',
      title: t('请求次数 Top 10'),
      items: rankings?.by_request_count || [],
      renderMetric: (item) => renderNumber(item.request_count || 0),
    },
    {
      key: 'by_used_quota',
      title: t('已用额度 Top 10'),
      items: rankings?.by_used_quota || [],
      renderMetric: (item) => renderQuota(item.used_quota || 0),
    },
    {
      key: 'by_last_request',
      title: t('最近请求 Top 10'),
      items: rankings?.by_last_request || [],
      renderMetric: (item) =>
        item.last_request_at > 0 ? timestamp2string(item.last_request_at) : t('未记录'),
    },
  ];

  return (
    <div className='mb-4'>
      <div className='grid grid-cols-1 lg:grid-cols-3 gap-4'>
        {sections.map((section) => (
          <Card key={section.key} className='!rounded-2xl' title={section.title} loading={loading}>
            {section.items.length > 0 ? (
              <div className='space-y-3'>
                {section.items.map((item, index) => (
                  <div key={`${section.key}-${item.id}-${index}`} className='flex items-center justify-between gap-3'>
                    <div className='min-w-0'>
                      <div className='flex items-center gap-2'>
                        <Text strong>{item.display_name || item.username}</Text>
                        <Tag color='white' shape='circle'>#{index + 1}</Tag>
                      </div>
                      <Text type='tertiary' size='small' className='block truncate'>
                        {item.username}
                        {item.group ? ` · ${item.group}` : ''}
                      </Text>
                    </div>
                    <Text strong>{section.renderMetric(item)}</Text>
                  </div>
                ))}
              </div>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('暂无数据')} />
            )}
          </Card>
        ))}
      </div>
    </div>
  );
};

export default AdminRankingsPanel;
