import { Body, Controller, Post } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Post('performance-evaluate')
  async getHello(@Body() body) {
    return this.appService.getPerformance(body);
  }
}
