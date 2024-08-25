import { Body, Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  async getHello(@Body() body) {
    return this.appService.getPerformance(body?.startDate, body?.endDate);
  }
}
