import { Module } from '@nestjs/common';
import { PrismaModule } from '../shared/prisma/prisma.module';
import { LiveLecturesController } from './live-lectures.controller';
import { LiveLecturesService } from './live-lectures.service';
import { LiveLectureRoomService } from './live-lecture-room.service';
import { LiveKitService } from './livekit.service';

@Module({
  imports: [PrismaModule],
  controllers: [LiveLecturesController],
  providers: [LiveLecturesService, LiveLectureRoomService, LiveKitService],
  exports: [LiveLecturesService],
})
export class LiveLecturesModule {}
