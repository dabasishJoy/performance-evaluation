import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { google } from 'googleapis';

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);
  getHello(): string {
    return 'Hello World!';
  }

  async fetchTasksByDateRange(startDate: string, endDate: string) {
    try {
      const url = `https://pattern50.atlassian.net/rest/api/2/search?jql=assignee=currentuser() AND (("due date" >= "${startDate}" AND "due date" <= "${endDate}") OR (duedate >= "${startDate}" AND duedate <= "${endDate}"))`;
      const response = await axios.get(url, {
        headers: {
          Authorization:
            'Basic ' +
            Buffer.from(
              `${process.env.JIRA_EMAIL}:${process.env.JIRA_API_KEY}`,
            ).toString('base64'),
          Accept: 'application/json',
        },
      });

      return response.data;
    } catch (e) {
      console.error(e.message || e);
    }
  }

  async getPerformance(startDate: string, endDate: string) {
    const tasks = await this.fetchTasksByDateRange(startDate, endDate);

    const result = await this.calculateTasks(tasks?.issues);

    await this.updateGoogleSheet(
      '1s0N-p0hqkYuh2i4m6TE2tsjnNDQ2YzKVOFKo-xVKwXA',
      'Date',
      result,
    );
    return result;
  }

  async calculateTasks(issues) {
    const tasksByDate = {};

    issues?.forEach((issue) => {
      const dueDate = issue?.fields?.customfield_10033;
      const options: any = { year: 'numeric', month: 'short', day: 'numeric' };
      const date =
        issue?.fields?.issuetype?.name === 'Story'
          ? new Date(issue?.fields?.duedate)?.toLocaleDateString(
              'en-US',
              options,
            )
          : new Date(dueDate).toLocaleDateString('en-US', options);
      const resolutionDate = issue?.fields?.resolutiondate;

      if (!tasksByDate[date]) {
        tasksByDate[date] = {
          totalTasks: 0,
          doneTasks: 0,
          totalBugs: 0,
          totalUs: 0,
          doneUs: 0,
        };
      }

      if (issue?.fields?.issuetype?.name === 'Story') {
        tasksByDate[date].totalUs += 1;
      } else {
        tasksByDate[date].totalTasks += 1;
      }

      if (
        issue?.fields?.issuetype?.name === 'Bug' &&
        !issue?.fields?.labels?.includes('Takeover')
      ) {
        tasksByDate[date].totalBugs += 1;
      }

      if (resolutionDate) {
        const resolutionDate = new Date(issue?.fields?.resolutiondate);
        const year = resolutionDate.getFullYear();
        const month = String(resolutionDate.getMonth() + 1).padStart(2, '0');
        const day = String(resolutionDate.getDate()).padStart(2, '0');

        const formattedDate = `${year}-${month}-${day}`;
        const dueDate = new Date(issue?.fields?.customfield_10033);
        const formattedResolutionDate = new Date(formattedDate);

        if (
          formattedResolutionDate <= dueDate &&
          issue?.fields?.issuetype?.name === 'Story' &&
          issue?.fields?.status?.name === 'User Stories (In Beta)'
        ) {
          tasksByDate[date].doneUs += 1;
        } else if (formattedResolutionDate <= dueDate) {
          tasksByDate[date].doneTasks += 1;
        }
      }
    });

    return tasksByDate;
  }

  async updateGoogleSheet(sheetId: string, fieldName: string, taskCounts: any) {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    try {
      await auth.getClient();
      const sheets = google.sheets({ version: 'v4', auth: auth });

      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: 'June 2024',
      });

      const rows = response.data.values;

      if (rows && rows.length > 0) {
        const headers = rows[0];
        const fieldIndex = headers.indexOf(fieldName);

        if (fieldIndex === -1) {
          throw new Error(
            `Field name '${fieldName}' not found in the sheet headers`,
          );
        }

        const updates: any[] = [];

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          const dueDate = row[fieldIndex]?.trim();

          if (!dueDate) {
            continue;
          }

          const normalizedDueDate = new Date(dueDate).toLocaleDateString(
            'en-US',
            {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            },
          );

          // Default to 0 if no data exists for the dueDate
          const updatedRow = [...row];
          updatedRow[headers.indexOf('Total Issues')] =
            taskCounts[normalizedDueDate]?.totalTasks || 0;
          updatedRow[headers.indexOf('Completed Tasks')] =
            taskCounts[normalizedDueDate]?.doneTasks || 0;
          updatedRow[headers.indexOf('Total Bugs')] =
            taskCounts[normalizedDueDate]?.totalBugs || 0;
          updatedRow[headers.indexOf('Total US')] =
            taskCounts[normalizedDueDate]?.totalUs || 0;
          updatedRow[headers.indexOf('Completed US')] =
            taskCounts[normalizedDueDate]?.doneUs || 0;

          // Determine the last non-empty column to update
          const lastColumn = String.fromCharCode(65 + updatedRow.length - 1);

          updates.push({
            range: `June 2024!A${i + 1}:${lastColumn}${i + 1}`,
            values: [updatedRow.slice(0, updatedRow.length)],
          });
        }

        if (updates.length > 0) {
          await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: sheetId,
            requestBody: {
              data: updates,
              valueInputOption: 'USER_ENTERED',
            },
          });

          console.log('Sheet updated successfully');
        } else {
          console.log('No matching due dates found for updates.');
        }
      } else {
        console.log('No data found in the sheet.');
      }
    } catch (error) {
      console.error(
        'Error accessing or updating the Google Sheets API:',
        error,
      );
    }
  }
}
