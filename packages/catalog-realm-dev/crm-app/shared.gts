import AlertHexagon from '@cardstack/boxel-icons/alert-hexagon';
import CalendarStar from '@cardstack/boxel-icons/calendar-star';
import CalendarMonth from '@cardstack/boxel-icons/calendar-month';
import ChevronsUp from '@cardstack/boxel-icons/chevrons-up';
import UserQuestion from '@cardstack/boxel-icons/user-question';

import { TaskStatusField } from './base-task';

export const taskStatusValues = [
  {
    index: 0,
    icon: AlertHexagon,
    label: 'Overdue',
    value: 'overdue',
  },
  {
    index: 1,
    icon: CalendarStar,
    label: 'Due Today',
    value: 'due-today',
  },
  {
    index: 2,
    icon: CalendarMonth,
    label: 'Due this week',
    value: 'due-this-week',
  },
  {
    index: 3,
    icon: ChevronsUp,
    label: 'High Priority',
    value: 'high-priority',
  },
  {
    index: 4,
    icon: UserQuestion,
    label: 'Unassigned',
    value: 'unassigned',
  },
];

export class CRMTaskStatusField extends TaskStatusField {
  static values = [
    { index: 0, label: 'Not Started', color: '#B0BEC5', completed: false },
    {
      index: 1,
      label: 'In Progress',
      color: '#FFB74D',
      completed: false,
    },
    {
      index: 2,
      label: 'Done',
      color: '#66BB6A',
      completed: true,
    },
  ];
}
