import { MeetingStatus } from '@prisma/client';

export class UpdateAdminMeetingDto {
  title?: string;
  description?: string;
  status?: MeetingStatus;
  isPublic?: boolean;
}
